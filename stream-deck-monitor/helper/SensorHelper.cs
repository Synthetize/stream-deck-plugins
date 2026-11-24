// SensorHelper.exe - native helper of the Stream Deck Monitor plugin (C# 5, built with the csc.exe that ships with Windows).
//
// Normal mode (started by the plugin, normal user, no admin needed):
//   * samples CPU / RAM / GPU / VRAM / disk / network from Windows performance counters and the IP helper API
//   * reads the game FPS from the RTSS shared memory ("RTSSSharedMemoryV2")
//   * reads temperatures: GPU through LibreHardwareMonitorLib (works without admin for most GPUs), CPU temperature
//     from the elevated "sensor server" below (CPU sensors need a kernel driver = administrator rights)
//   * prints one JSON object per line on stdout; reads simple text commands on stdin ("interval <ms>", "quit")
//
// --sensor-server (started elevated through a scheduled task, see --install-task):
//   * reads CPU/GPU/board temperatures with LibreHardwareMonitorLib (+ PawnIO driver) and publishes them as JSON in
//     %LOCALAPPDATA%\StreamDeckMonitor\temps.json. It exits when nobody asked for the data for a while.
//
// --install-task / --uninstall-task (must run elevated): one-time setup / removal of the scheduled task.
// --once          : prints one sample (after a short warm-up) and exits (used for testing)
// --dump-sensors  : prints every sensor LibreHardwareMonitorLib can see (diagnostics)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Net.NetworkInformation;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace StreamDeckMonitor
{
    static class Const
    {
        public const string Version = "1.0.0";
        public const string TaskName = "StreamDeckMonitorSensors";
        public const string InstallDirName = "StreamDeckMonitor";
        public const string DataDirName = "StreamDeckMonitor";
    }

    static class Json
    {
        public static string Str(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        public static string Num(double? v, string fmt)
        {
            if (!v.HasValue || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return "null";
            return v.Value.ToString(fmt, CultureInfo.InvariantCulture);
        }
    }

    static class Paths
    {
        public static string DataDir
        {
            get
            {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Const.DataDirName);
                Directory.CreateDirectory(d);
                return d;
            }
        }
        public static string TempsFile { get { return Path.Combine(DataDir, "temps.json"); } }
        public static string WantFile { get { return Path.Combine(DataDir, "want.txt"); } }
        public static string ExeDir { get { return AppDomain.CurrentDomain.BaseDirectory; } }
    }

    // ------------------------------------------------------------------------------------------------ LibreHardwareMonitor
    class TempSensor
    {
        public string HwType, Hw, Name;
        public double Value;
    }

    /// <summary>Thin wrapper around LibreHardwareMonitorLib. Only touched inside try/catch: the DLL may be missing.</summary>
    class LhmReader
    {
        LibreHardwareMonitor.Hardware.Computer computer;

        public LhmReader(bool cpu, bool gpu, bool board)
        {
            computer = new LibreHardwareMonitor.Hardware.Computer();
            computer.IsCpuEnabled = cpu;
            computer.IsGpuEnabled = gpu;
            computer.IsMotherboardEnabled = board;
            computer.Open();
        }

        void UpdateAll()
        {
            foreach (LibreHardwareMonitor.Hardware.IHardware hw in computer.Hardware) UpdateHw(hw);
        }

        static void UpdateHw(LibreHardwareMonitor.Hardware.IHardware hw)
        {
            hw.Update();
            foreach (LibreHardwareMonitor.Hardware.IHardware sub in hw.SubHardware) UpdateHw(sub);
        }

        public List<TempSensor> ReadTemps()
        {
            UpdateAll();
            List<TempSensor> list = new List<TempSensor>();
            foreach (LibreHardwareMonitor.Hardware.IHardware hw in computer.Hardware) Collect(hw, list);
            return list;
        }

        static void Collect(LibreHardwareMonitor.Hardware.IHardware hw, List<TempSensor> list)
        {
            foreach (LibreHardwareMonitor.Hardware.ISensor s in hw.Sensors)
            {
                if (s.SensorType != LibreHardwareMonitor.Hardware.SensorType.Temperature || !s.Value.HasValue) continue;
                TempSensor t = new TempSensor();
                t.HwType = hw.HardwareType.ToString();
                t.Hw = hw.Name;
                t.Name = s.Name;
                t.Value = s.Value.Value;
                list.Add(t);
            }
            foreach (LibreHardwareMonitor.Hardware.IHardware sub in hw.SubHardware) Collect(sub, list);
        }

        public List<string> DumpAll()
        {
            UpdateAll();
            List<string> lines = new List<string>();
            foreach (LibreHardwareMonitor.Hardware.IHardware hw in computer.Hardware) DumpHw(hw, lines, "");
            return lines;
        }

        static void DumpHw(LibreHardwareMonitor.Hardware.IHardware hw, List<string> lines, string indent)
        {
            lines.Add(indent + hw.HardwareType + ": " + hw.Name);
            foreach (LibreHardwareMonitor.Hardware.ISensor s in hw.Sensors)
                lines.Add(indent + "  " + s.SensorType + " | " + s.Name + " = " + (s.Value.HasValue ? s.Value.Value.ToString(CultureInfo.InvariantCulture) : "n/a"));
            foreach (LibreHardwareMonitor.Hardware.IHardware sub in hw.SubHardware) DumpHw(sub, lines, indent + "  ");
        }

        public void Close()
        {
            try { computer.Close(); } catch { }
        }
    }

    static class Lhm
    {
        // NoInlining: the JIT must not try to resolve LibreHardwareMonitorLib outside of our try/catch.
        [MethodImpl(MethodImplOptions.NoInlining)]
        public static LhmReader Create(bool cpu, bool gpu, bool board) { return new LhmReader(cpu, gpu, board); }

        public static bool LibraryPresent
        {
            get { return File.Exists(Path.Combine(Paths.ExeDir, "LibreHardwareMonitorLib.dll")); }
        }

        public static bool PawnIoInstalled
        {
            get
            {
                try
                {
                    using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO"))
                        if (k != null) return true;
                }
                catch { }
                string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                return File.Exists(Path.Combine(pf, "PawnIO", "PawnIOLib.dll"));
            }
        }

        /// <summary>Picks the most meaningful temperature of a hardware type.</summary>
        public static double? Pick(List<TempSensor> all, string hwType)
        {
            string[] prefer = { "Core (Tctl/Tdie)", "CPU Package", "Package", "Core Max", "Tctl", "GPU Core", "GPU Hot Spot", "CPU Die", "CPU" };
            List<TempSensor> mine = all.FindAll(delegate (TempSensor t) { return t.HwType.StartsWith(hwType, StringComparison.OrdinalIgnoreCase); });
            if (mine.Count == 0) return null;
            foreach (string p in prefer)
            {
                TempSensor hit = mine.Find(delegate (TempSensor t) { return t.Name.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0 && t.Value > 0 && t.Value < 150; });
                if (hit != null) return hit.Value;
            }
            double max = 0;
            foreach (TempSensor t in mine) if (t.Value > max && t.Value < 150) max = t.Value;
            return max > 0 ? (double?)max : null;
        }
    }

    // ------------------------------------------------------------------------------------------------ sensor server (elevated)
    static class SensorServer
    {
        [DllImport("kernel32.dll")] static extern bool FreeConsole();

        public static int Run()
        {
            bool created;
            using (Mutex mutex = new Mutex(true, "Global\\StreamDeckMonitorSensorServer", out created))
            {
                if (!created) return 0; // already running
                try { FreeConsole(); } catch { }
                string file = Paths.TempsFile;
                string tmp = file + ".tmp";
                LhmReader reader = null;
                string error = null;
                try { reader = Lhm.Create(true, true, true); }
                catch (Exception ex) { error = ex.GetType().Name + ": " + ex.Message; }

                DateTime start = DateTime.UtcNow;
                while (true)
                {
                    // Exit when nobody has asked for data for a while (the plugin touches want.txt every few seconds).
                    DateTime want = DateTime.MinValue;
                    try { if (File.Exists(Paths.WantFile)) want = File.GetLastWriteTimeUtc(Paths.WantFile); } catch { }
                    DateTime ref0 = want > start ? want : start;
                    if ((DateTime.UtcNow - ref0).TotalSeconds > 45) break;

                    List<TempSensor> temps = new List<TempSensor>();
                    if (reader != null)
                    {
                        try { temps = reader.ReadTemps(); }
                        catch (Exception ex) { error = ex.GetType().Name + ": " + ex.Message; }
                    }
                    StringBuilder sb = new StringBuilder();
                    sb.Append("{\"ver\":").Append(Json.Str(Const.Version));
                    sb.Append(",\"ts\":").Append(((long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds).ToString(CultureInfo.InvariantCulture));
                    sb.Append(",\"pawnio\":").Append(Lhm.PawnIoInstalled ? "true" : "false");
                    sb.Append(",\"error\":").Append(Json.Str(error));
                    sb.Append(",\"cpu\":").Append(Json.Num(Lhm.Pick(temps, "Cpu"), "0.#"));
                    sb.Append(",\"gpu\":").Append(Json.Num(Lhm.Pick(temps, "Gpu"), "0.#"));
                    sb.Append(",\"sensors\":[");
                    for (int i = 0; i < temps.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append("{\"type\":").Append(Json.Str(temps[i].HwType)).Append(",\"hw\":").Append(Json.Str(temps[i].Hw))
                          .Append(",\"name\":").Append(Json.Str(temps[i].Name)).Append(",\"value\":").Append(Json.Num(temps[i].Value, "0.#")).Append('}');
                    }
                    sb.Append("]}");
                    try
                    {
                        File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                        if (File.Exists(file)) File.Delete(file);
                        File.Move(tmp, file);
                    }
                    catch { }
                    Thread.Sleep(1000);
                }
                if (reader != null) reader.Close();
                try { File.Delete(file); } catch { }
            }
            return 0;
        }
    }

    // ------------------------------------------------------------------------------------------------ scheduled task (install / uninstall)
    static class TaskSetup
    {
        static bool IsAdmin()
        {
            return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        }

        static int RunProcess(string exe, string args, out string output)
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            using (Process p = Process.Start(psi))
            {
                output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                return p.ExitCode;
            }
        }

        public static bool TaskExists()
        {
            try
            {
                string o;
                return RunProcess("schtasks.exe", "/query /tn " + Const.TaskName, out o) == 0;
            }
            catch { return false; }
        }

        public static void StartTask()
        {
            try { string o; RunProcess("schtasks.exe", "/run /tn " + Const.TaskName, out o); } catch { }
        }

        static string InstallDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Const.InstallDirName); }
        }

        public static int Install()
        {
            if (!IsAdmin()) { Console.Error.WriteLine("Administrator rights are required."); return 2; }
            try
            {
                // The elevated program is copied to Program Files (writable only by administrators): the scheduled task
                // must never run an executable that a normal process could replace.
                StopRunningServer();
                string dir = InstallDir;
                Directory.CreateDirectory(dir);
                foreach (string f in Directory.GetFiles(Paths.ExeDir))
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    if (ext == ".exe" || ext == ".dll" || ext == ".config" || ext == ".txt" || ext == ".md")
                        File.Copy(f, Path.Combine(dir, Path.GetFileName(f)), true);
                }
                string sid = WindowsIdentity.GetCurrent().User.Value;
                string xml =
                    "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
                    "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n" +
                    "  <RegistrationInfo><Description>Stream Deck Monitor: reads CPU temperature sensors with administrator rights (started on demand by the plugin).</Description></RegistrationInfo>\r\n" +
                    "  <Triggers/>\r\n" +
                    "  <Principals><Principal id=\"Author\"><UserId>" + sid + "</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>\r\n" +
                    "  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>" +
                    "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable>" +
                    "<AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority></Settings>\r\n" +
                    "  <Actions Context=\"Author\"><Exec><Command>" + System.Security.SecurityElement.Escape(Path.Combine(dir, "SensorHelper.exe")) +
                    "</Command><Arguments>--sensor-server</Arguments></Exec></Actions>\r\n" +
                    "</Task>";
                string xmlFile = Path.Combine(Path.GetTempPath(), "sdmonitor-task.xml");
                File.WriteAllText(xmlFile, xml, Encoding.Unicode);
                string output;
                int code = RunProcess("schtasks.exe", "/create /tn " + Const.TaskName + " /xml \"" + xmlFile + "\" /f", out output);
                try { File.Delete(xmlFile); } catch { }
                if (code != 0) { Console.Error.WriteLine(output); return code; }
                Console.WriteLine("Task installed. Program files copied to " + dir);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }

        static void StopRunningServer()
        {
            try { string o; RunProcess("schtasks.exe", "/end /tn " + Const.TaskName, out o); } catch { }
            try { File.WriteAllText(Paths.WantFile, "stop"); File.SetLastWriteTimeUtc(Paths.WantFile, new DateTime(2000, 1, 1)); } catch { }
            for (int i = 0; i < 20; i++)
            {
                bool running = false;
                foreach (Process p in Process.GetProcessesByName("SensorHelper"))
                {
                    try
                    {
                        if (p.Id != Process.GetCurrentProcess().Id && p.MainModule.FileName.StartsWith(InstallDir, StringComparison.OrdinalIgnoreCase))
                        {
                            running = true;
                            if (i > 8) p.Kill();
                        }
                    }
                    catch { }
                }
                if (!running) return;
                Thread.Sleep(250);
            }
        }

        public static int Uninstall()
        {
            if (!IsAdmin()) { Console.Error.WriteLine("Administrator rights are required."); return 2; }
            StopRunningServer();
            string o;
            RunProcess("schtasks.exe", "/delete /tn " + Const.TaskName + " /f", out o);
            try { Directory.Delete(InstallDir, true); } catch { }
            Console.WriteLine("Task and program files removed.");
            return 0;
        }
    }

    // ------------------------------------------------------------------------------------------------ sampler (normal user)
    class Sampler
    {
        [StructLayout(LayoutKind.Sequential)]
        struct MEMORYSTATUSEX
        {
            public uint dwLength, dwMemoryLoad;
            public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
        }
        [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

        PerformanceCounter cpu, diskRead, diskWrite, diskTime;
        readonly Dictionary<string, PerformanceCounter> gpuEngines = new Dictionary<string, PerformanceCounter>();
        readonly Dictionary<string, PerformanceCounter> gpuMem = new Dictionary<string, PerformanceCounter>();
        DateTime gpuRefresh = DateTime.MinValue;
        double? vramTotal;

        // network
        readonly Dictionary<string, long[]> netPrev = new Dictionary<string, long[]>();
        DateTime netTime = DateTime.MinValue;

        // temperatures
        LhmReader gpuLhm;
        bool lhmTried;
        double? gpuTemp;
        public static volatile bool RescanRequested;
        DateTime tempTime = DateTime.MinValue;
        DateTime wantTouched = DateTime.MinValue;
        DateTime taskCheck = DateTime.MinValue;
        DateTime taskStart = DateTime.MinValue;
        bool taskInstalled;

        // ping (ICMP) to a user chosen host, once per second, only while enabled
        public static volatile bool PingEnabled;
        public static volatile string PingHost = "1.1.1.1";
        readonly Queue<bool> pingHistory = new Queue<bool>();
        double? pingLast;
        Thread pingThread;
        const int PingWindow = 60;

        void StartPing()
        {
            pingThread = new Thread(PingLoop);
            pingThread.IsBackground = true;
            pingThread.Start();
        }

        void PingLoop()
        {
            using (Ping p = new Ping())
            {
                string lastHost = null;
                while (true)
                {
                    DateTime t0 = DateTime.UtcNow;
                    if (!PingEnabled) { Thread.Sleep(500); continue; }
                    string host = PingHost;
                    bool ok = false; double rtt = 0;
                    try
                    {
                        PingReply r = p.Send(host, 1000);
                        ok = r.Status == IPStatus.Success;
                        rtt = r.RoundtripTime;
                    }
                    catch { }
                    lock (pingHistory)
                    {
                        if (lastHost != null && lastHost != host) { pingHistory.Clear(); }
                        lastHost = host;
                        pingHistory.Enqueue(ok);
                        while (pingHistory.Count > PingWindow) pingHistory.Dequeue();
                        pingLast = ok ? (double?)rtt : null;
                    }
                    int wait = 1000 - (int)(DateTime.UtcNow - t0).TotalMilliseconds;
                    if (wait > 0) Thread.Sleep(wait);
                }
            }
        }

        void PingStats(out double? rtt, out double? loss)
        {
            lock (pingHistory)
            {
                rtt = pingLast;
                if (pingHistory.Count == 0) { loss = null; return; }
                int lost = 0;
                foreach (bool b in pingHistory) if (!b) lost++;
                loss = 100.0 * lost / pingHistory.Count;
            }
        }
        public Sampler()
        {
            StartPing();
            cpu = Make("Processor Information", "% Processor Time", "_Total") ?? Make("Processor", "% Processor Time", "_Total");
            diskRead = Make("PhysicalDisk", "Disk Read Bytes/sec", "_Total");
            diskWrite = Make("PhysicalDisk", "Disk Write Bytes/sec", "_Total");
            diskTime = Make("PhysicalDisk", "% Disk Time", "_Total");
            vramTotal = ReadVramTotal();
        }

        static PerformanceCounter Make(string cat, string counter, string inst)
        {
            try
            {
                PerformanceCounter c = new PerformanceCounter(cat, counter, inst, true);
                c.NextValue();
                return c;
            }
            catch { return null; }
        }

        static double? Next(PerformanceCounter c)
        {
            if (c == null) return null;
            try { return c.NextValue(); } catch { return null; }
        }

        static double? ReadVramTotal()
        {
            try
            {
                long best = 0;
                using (RegistryKey cls = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"))
                {
                    if (cls == null) return null;
                    foreach (string name in cls.GetSubKeyNames())
                    {
                        if (name.Length != 4) continue;
                        using (RegistryKey k = cls.OpenSubKey(name))
                        {
                            if (k == null) continue;
                            object v = k.GetValue("HardwareInformation.qwMemorySize");
                            long n = 0;
                            if (v is long) n = (long)v;
                            else if (v is byte[] && ((byte[])v).Length >= 8) n = BitConverter.ToInt64((byte[])v, 0);
                            else
                            {
                                v = k.GetValue("HardwareInformation.MemorySize");
                                if (v is int) n = (uint)(int)v;
                                else if (v is byte[] && ((byte[])v).Length >= 4) n = BitConverter.ToUInt32((byte[])v, 0);
                            }
                            if (n > best) best = n;
                        }
                    }
                }
                return best > 0 ? (double?)best : null;
            }
            catch { return null; }
        }

        // ---- GPU counters (vendor independent: AMD, NVIDIA and Intel all feed the Windows "GPU Engine" counters)
        void RefreshGpuInstances()
        {
            if ((DateTime.UtcNow - gpuRefresh).TotalSeconds < 4) return;
            gpuRefresh = DateTime.UtcNow;
            try
            {
                SyncCounters(gpuEngines, "GPU Engine", "Utilization Percentage", delegate (string n) { return n.Contains("_engtype_"); });
                SyncCounters(gpuMem, "GPU Adapter Memory", "Dedicated Usage", delegate (string n) { return true; });
            }
            catch { }
        }

        static void SyncCounters(Dictionary<string, PerformanceCounter> dict, string cat, string counter, Predicate<string> filter)
        {
            if (!PerformanceCounterCategory.Exists(cat)) return;
            string[] names = new PerformanceCounterCategory(cat).GetInstanceNames();
            HashSet<string> alive = new HashSet<string>();
            foreach (string n in names)
            {
                if (!filter(n)) continue;
                alive.Add(n);
                if (dict.ContainsKey(n)) continue;
                try { PerformanceCounter pc = new PerformanceCounter(cat, counter, n, true); pc.NextValue(); dict[n] = pc; } catch { }
            }
            List<string> dead = new List<string>();
            foreach (string n in dict.Keys) if (!alive.Contains(n)) dead.Add(n);
            foreach (string n in dead) { dict[n].Dispose(); dict.Remove(n); }
        }

        double? GpuUsage()
        {
            if (gpuEngines.Count == 0) return null;
            Dictionary<string, double> perType = new Dictionary<string, double>();
            foreach (KeyValuePair<string, PerformanceCounter> kv in gpuEngines)
            {
                double? v = Next(kv.Value);
                if (!v.HasValue) continue;
                int i = kv.Key.IndexOf("_engtype_", StringComparison.Ordinal);
                string type = kv.Key.Substring(i + 9);
                double cur;
                perType.TryGetValue(type, out cur);
                perType[type] = cur + v.Value;
            }
            double max = 0;
            foreach (double d in perType.Values) if (d > max) max = d;
            return Math.Min(100, max); // like Task Manager: the busiest engine type
        }

        double? GpuMemUsed()
        {
            if (gpuMem.Count == 0) return null;
            double sum = 0;
            bool any = false;
            foreach (PerformanceCounter c in gpuMem.Values)
            {
                double? v = Next(c);
                if (v.HasValue) { sum += v.Value; any = true; }
            }
            return any ? (double?)sum : null;
        }

        // ---- network (bytes/s over all physical adapters that are up)
        void Network(out double? down, out double? up)
        {
            down = null; up = null;
            try
            {
                DateTime now = DateTime.UtcNow;
                double dt = (now - netTime).TotalSeconds;
                long rx = 0, tx = 0;
                double rate = 0, rateUp = 0;
                bool have = false;
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                    string d = ni.Description;
                    if (d.IndexOf("Virtual", StringComparison.OrdinalIgnoreCase) >= 0 || d.IndexOf("VMware", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        d.IndexOf("Hyper-V", StringComparison.OrdinalIgnoreCase) >= 0 || d.IndexOf("Pseudo", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        d.IndexOf("Bluetooth", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    IPv4InterfaceStatistics st = ni.GetIPv4Statistics();
                    rx = st.BytesReceived; tx = st.BytesSent;
                    long[] prev;
                    if (netPrev.TryGetValue(ni.Id, out prev) && dt > 0.05 && dt < 30)
                    {
                        rate += Math.Max(0, rx - prev[0]) / dt;
                        rateUp += Math.Max(0, tx - prev[1]) / dt;
                        have = true;
                    }
                    netPrev[ni.Id] = new long[] { rx, tx };
                }
                netTime = now;
                if (have) { down = rate; up = rateUp; }
            }
            catch { }
        }

        // ---- RTSS (RivaTuner Statistics Server) shared memory
        public static void ReadRtss(out double? fps, out string app, out string state)
        {
            fps = null; app = null;
            // Layout: RTSS_SHARED_MEMORY { dwSignature 'RTSS', dwVersion, dwAppEntrySize, dwAppArrOffset, dwAppArrSize, ... }
            // RTSS_SHARED_MEMORY_APP_ENTRY { dwProcessID, szName[260], dwFlags, dwTime0, dwTime1, dwFrames, dwFrameTime, ... }
            try
            {
                using (MemoryMappedFile mmf = MemoryMappedFile.OpenExisting("RTSSSharedMemoryV2", MemoryMappedFileRights.Read))
                using (MemoryMappedViewAccessor acc = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read))
                {
                    uint sig = acc.ReadUInt32(0);
                    uint ver = acc.ReadUInt32(4);
                    if (sig != 0x52545353 && sig != 0x53535452) { state = "bad-signature"; return; } // 'RTSS' (either byte order)
                    if (ver < 0x00020000) { state = "old-version"; return; }
                    uint entrySize = acc.ReadUInt32(8), arrOffset = acc.ReadUInt32(12), arrSize = acc.ReadUInt32(16);
                    uint tick = (uint)Environment.TickCount;
                    double bestFps = 0; string bestApp = null; uint bestAge = uint.MaxValue;
                    for (uint i = 0; i < arrSize && i < 256; i++)
                    {
                        long o = arrOffset + (long)i * entrySize;
                        uint pid = acc.ReadUInt32(o);
                        if (pid == 0) continue;
                        byte[] nameBytes = new byte[260];
                        acc.ReadArray(o + 4, nameBytes, 0, 260);
                        int len = Array.IndexOf(nameBytes, (byte)0);
                        string name = Encoding.Default.GetString(nameBytes, 0, len < 0 ? 260 : len);
                        uint t0 = acc.ReadUInt32(o + 268), t1 = acc.ReadUInt32(o + 272), frames = acc.ReadUInt32(o + 276);
                        if (t1 <= t0 || frames == 0) continue;
                        uint age = unchecked(tick - t1);
                        if (age > 2500) continue; // the application stopped presenting frames
                        double f = 1000.0 * frames / (t1 - t0);
                        if (age < bestAge) { bestAge = age; bestFps = f; bestApp = Path.GetFileNameWithoutExtension(name); }
                    }
                    if (bestApp != null) { fps = bestFps; app = bestApp; state = "ok"; }
                    else state = "idle"; // RTSS is running but no hooked application is rendering
                }
            }
            catch (FileNotFoundException) { state = "no-rtss"; }
            catch (Exception) { state = "no-rtss"; }
        }

        // ---- temperatures
        void UpdateTemps(out double? cpuT, out double? gpuT, out string status, out string detail)
        {
            cpuT = null; gpuT = null; detail = null;
            DateTime now = DateTime.UtcNow;
            if (RescanRequested) { RescanRequested = false; taskCheck = DateTime.MinValue; taskStart = DateTime.MinValue; }

            // GPU temperature: LibreHardwareMonitorLib in this (non elevated) process, read every ~2 s
            if (!lhmTried)
            {
                lhmTried = true;
                if (Lhm.LibraryPresent)
                {
                    try { gpuLhm = Lhm.Create(false, true, false); } catch (Exception ex) { gpuLhm = null; detail = ex.Message; }
                }
            }
            if (gpuLhm != null && (now - tempTime).TotalSeconds >= 2)
            {
                tempTime = now;
                try
                {
                    List<TempSensor> t = gpuLhm.ReadTemps();
                    gpuTemp = Lhm.Pick(t, "Gpu");
                }
                catch { gpuTemp = null; }
            }
            gpuT = gpuTemp;

            // CPU temperature: elevated sensor server (scheduled task) publishes temps.json
            if (!Lhm.LibraryPresent) { status = "no-lib"; return; }
            if ((now - taskCheck).TotalSeconds > 30)
            {
                taskCheck = now;
                taskInstalled = TaskSetup.TaskExists();
            }
            string json = null;
            try
            {
                if (File.Exists(Paths.TempsFile)) json = File.ReadAllText(Paths.TempsFile, Encoding.UTF8);
            }
            catch { }
            bool fresh = false;
            if (json != null)
            {
                try
                {
                    if (File.GetLastWriteTimeUtc(Paths.TempsFile) > now.AddSeconds(-6)) fresh = true;
                }
                catch { }
            }
            if (taskInstalled)
            {
                // Tell the server somebody still wants data, and start it if it is not running.
                if ((now - wantTouched).TotalSeconds > 5)
                {
                    wantTouched = now;
                    try { File.WriteAllText(Paths.WantFile, now.ToString("o")); } catch { }
                }
                if (!fresh && (now - taskStart).TotalSeconds > 15)
                {
                    taskStart = now;
                    TaskSetup.StartTask();
                }
            }
            if (!taskInstalled) { status = "not-installed"; return; }
            if (!fresh || json == null) { status = "starting"; return; }

            double? c = ExtractNumber(json, "\"cpu\":");
            if (!gpuT.HasValue) gpuT = ExtractNumber(json, "\"gpu\":");
            cpuT = c;
            if (c.HasValue) { status = "ok"; return; }
            bool pawn = json.Contains("\"pawnio\":true");
            status = pawn ? "unsupported" : "no-driver";
            int e = json.IndexOf("\"error\":", StringComparison.Ordinal);
            if (e >= 0 && !json.Substring(e + 8, 4).StartsWith("null")) detail = json.Substring(e + 8, Math.Min(200, json.Length - e - 8));
        }

        static double? ExtractNumber(string json, string key)
        {
            int i = json.IndexOf(key, StringComparison.Ordinal);
            if (i < 0) return null;
            i += key.Length;
            int j = i;
            while (j < json.Length && "-0123456789.".IndexOf(json[j]) >= 0) j++;
            if (j == i) return null;
            double v;
            return double.TryParse(json.Substring(i, j - i), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? (double?)v : null;
        }

        // ---- one sample as a JSON line
        public string Sample()
        {
            RefreshGpuInstances();
            double? cpuV = Next(cpu);
            if (cpuV.HasValue) cpuV = Math.Max(0, Math.Min(100, cpuV.Value));
            MEMORYSTATUSEX m = new MEMORYSTATUSEX();
            m.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            double? ramPct = null, ramUsed = null, ramTotal = null;
            if (GlobalMemoryStatusEx(ref m))
            {
                ramTotal = m.ullTotalPhys;
                ramUsed = m.ullTotalPhys - m.ullAvailPhys;
                ramPct = 100.0 * (m.ullTotalPhys - m.ullAvailPhys) / m.ullTotalPhys;
            }
            double? gpuV = GpuUsage();
            double? vramUsed = GpuMemUsed();
            double? vramPct = (vramUsed.HasValue && vramTotal.HasValue) ? (double?)Math.Min(100, 100.0 * vramUsed.Value / vramTotal.Value) : null;
            double? dRead = Next(diskRead), dWrite = Next(diskWrite), dTime = Next(diskTime);
            if (dTime.HasValue) dTime = Math.Min(100, dTime.Value);
            double? down, up;
            Network(out down, out up);
            double? fps; string fpsApp, fpsState;
            ReadRtss(out fps, out fpsApp, out fpsState);
            double? pingV, lossV;
            PingStats(out pingV, out lossV);
            double? cpuT, gpuT; string tStatus, tDetail;
            UpdateTemps(out cpuT, out gpuT, out tStatus, out tDetail);

            StringBuilder sb = new StringBuilder("{\"type\":\"sample\"");
            sb.Append(",\"cpu\":").Append(Json.Num(cpuV, "0.#"));
            sb.Append(",\"ram\":").Append(Json.Num(ramPct, "0.#"));
            sb.Append(",\"ramUsed\":").Append(Json.Num(ramUsed, "0"));
            sb.Append(",\"ramTotal\":").Append(Json.Num(ramTotal, "0"));
            sb.Append(",\"gpu\":").Append(Json.Num(gpuV, "0.#"));
            sb.Append(",\"vram\":").Append(Json.Num(vramPct, "0.#"));
            sb.Append(",\"vramUsed\":").Append(Json.Num(vramUsed, "0"));
            sb.Append(",\"vramTotal\":").Append(Json.Num(vramTotal, "0"));
            sb.Append(",\"disk\":").Append(Json.Num(dTime, "0.#"));
            sb.Append(",\"diskRead\":").Append(Json.Num(dRead, "0"));
            sb.Append(",\"diskWrite\":").Append(Json.Num(dWrite, "0"));
            sb.Append(",\"netDown\":").Append(Json.Num(down, "0"));
            sb.Append(",\"netUp\":").Append(Json.Num(up, "0"));
            sb.Append(",\"fps\":").Append(Json.Num(fps, "0.#"));
            sb.Append(",\"fpsApp\":").Append(Json.Str(fpsApp));
            sb.Append(",\"fpsState\":").Append(Json.Str(fpsState));
            sb.Append(",\"ping\":").Append(Json.Num(pingV, "0.#"));
            sb.Append(",\"loss\":").Append(Json.Num(lossV, "0.#"));
            sb.Append(",\"pingHost\":").Append(Json.Str(PingHost));
            sb.Append(",\"cpuTemp\":").Append(Json.Num(cpuT, "0.#"));
            sb.Append(",\"gpuTemp\":").Append(Json.Num(gpuT, "0.#"));
            sb.Append(",\"tempStatus\":").Append(Json.Str(tStatus));
            sb.Append(",\"tempDetail\":").Append(Json.Str(tDetail));
            sb.Append(",\"pawnio\":").Append(Lhm.PawnIoInstalled ? "true" : "false");
            sb.Append('}');
            return sb.ToString();
        }

        public void Close()
        {
            if (gpuLhm != null) gpuLhm.Close();
        }
    }

    static class Program
    {
        static volatile int intervalMs = 1000;
        static volatile bool quit;

        static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            string mode = args.Length > 0 ? args[0] : "";
            switch (mode)
            {
                case "--sensor-server": return SensorServer.Run();
                case "--install-task": return TaskSetup.Install();
                case "--uninstall-task": return TaskSetup.Uninstall();
                case "--dump-sensors":
                    try
                    {
                        LhmReader r = Lhm.Create(true, true, true);
                        Thread.Sleep(500);
                        foreach (string l in r.DumpAll()) Console.WriteLine(l);
                        r.Close();
                    }
                    catch (Exception ex) { Console.WriteLine("LibreHardwareMonitor failed: " + ex); }
                    return 0;
                case "--once":
                {
                    Sampler s = new Sampler();
                    Thread.Sleep(1500);
                    s.Sample();
                    Thread.Sleep(1200);
                    Console.WriteLine(s.Sample());
                    s.Close();
                    return 0;
                }
            }

            Thread reader = new Thread(ReadCommands);
            reader.IsBackground = true;
            reader.Start();

            Sampler sampler = new Sampler();
            Console.WriteLine("{\"type\":\"hello\",\"version\":\"" + Const.Version + "\"}");
            Console.Out.Flush();
            while (!quit)
            {
                try { Console.WriteLine(sampler.Sample()); Console.Out.Flush(); }
                catch (Exception ex) { Console.WriteLine("{\"type\":\"error\",\"message\":" + Json.Str(ex.Message) + "}"); Console.Out.Flush(); }
                // sleep in small steps so "quit" and interval changes apply quickly
                int waited = 0;
                while (waited < intervalMs && !quit) { Thread.Sleep(50); waited += 50; }
            }
            sampler.Close();
            return 0;
        }

        static void ReadCommands()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line.Trim();
                if (line == "quit") { quit = true; return; }
                if (line == "rescan") Sampler.RescanRequested = true;
                if (line == "ping off") Sampler.PingEnabled = false;
                if (line.StartsWith("ping on ")) { string h = line.Substring(8).Trim(); if (h.Length > 0 && h.Length <= 253 && h.IndexOf(' ') < 0) { Sampler.PingHost = h; Sampler.PingEnabled = true; } }
                if (line.StartsWith("interval "))
                {
                    int v;
                    if (int.TryParse(line.Substring(9), out v)) intervalMs = Math.Max(250, Math.Min(10000, v));
                }
            }
            quit = true; // stdin closed: the plugin is gone
        }
    }
}

