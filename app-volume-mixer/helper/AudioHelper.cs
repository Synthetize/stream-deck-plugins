// AudioHelper.exe - native helper for the "App Volume Mixer" Stream Deck plugin.
//
// Built with the C# compiler of the .NET Framework 4.x that ships with Windows
// (C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe): no SDK and no extra
// runtime to install. Syntax limited to C# 5.
//
// Protocol (one line per command on stdin, one JSON line per reply on stdout):
//   list                   -> {"type":"sessions","sessions":[{name,label,pid,volume,muted,path}]}
//   icon <name>            -> {"type":"icon","name":..,"png":"<base64>"|null}
//   set <name> <0-100>     -> {"type":"ok"}       (sets the volume of all sessions of the process)
//   mute <name> <0|1>      -> {"type":"ok"}
//   quit                   -> exits
// Names may contain spaces (e.g. "riot client"). Every reply also carries "id" if the command starts with "#<id> ".

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace AppVolumeMixer
{
    // ---------------------------------------------------------------- COM interop

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom { }

    enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, int role, out IMMDevice device);
        // other methods not used
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
        // other methods not used
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    enum AudioSessionState { Inactive = 0, Active = 1, Expired = 2 }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out AudioSessionState state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid groupingParam, ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute(bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute(out bool mute);
    }

    static class Native
    {
        public const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(int access, bool inherit, uint pid);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder exeName, ref int size);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyIcon(IntPtr icon);
    }

    // ---------------------------------------------------------------- model

    class AppSession
    {
        public string Name;     // key: lowercase executable name without .exe (e.g. "spotify"), "system" for system sounds
        public string Label;    // readable name
        public string Path;     // full path of the executable (if available)
        public uint Pid;
        public float Volume;
        public bool Muted;
        public bool Active;
        public List<ISimpleAudioVolume> Volumes = new List<ISimpleAudioVolume>();
    }

    static class Program
    {
        static readonly Dictionary<string, string> IconCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        static readonly Dictionary<string, string> PathByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        static readonly Dictionary<uint, string[]> ProcInfoCache = new Dictionary<uint, string[]>();
        static Guid EmptyGuid = Guid.Empty;

        [STAThread]
        static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;

            // One-shot mode, handy for tests: AudioHelper.exe list
            if (args.Length > 0)
            {
                stdout.WriteLine(Handle(string.Join(" ", args)));
                return 0;
            }

            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line.Trim().TrimStart('﻿').Trim();
                if (line.Length == 0) continue;
                if (line == "quit") break;
                string id = null;
                if (line.StartsWith("#"))
                {
                    int sp = line.IndexOf(' ');
                    if (sp > 0) { id = line.Substring(1, sp - 1); line = line.Substring(sp + 1).Trim(); }
                }
                string result;
                try { result = Handle(line); }
                catch (Exception ex) { result = "{\"type\":\"error\",\"message\":" + Json(ex.Message) + "}"; }
                if (id != null) result = "{\"id\":" + Json(id) + "," + result.Substring(1);
                stdout.WriteLine(result);
            }
            return 0;
        }

        static string Handle(string line)
        {
            line = line.Trim();
            int firstSpace = line.IndexOf(' ');
            string cmd = (firstSpace < 0 ? line : line.Substring(0, firstSpace)).ToLowerInvariant();
            // Process names can contain spaces (e.g. "riot client"), so the name is NOT split on spaces:
            //   icon <name>          -> the name is everything after the command
            //   set|mute <name> <v>  -> the value is the last token, the name is everything in between
            string rest = firstSpace < 0 ? "" : line.Substring(firstSpace + 1).Trim();
            switch (cmd)
            {
                case "list":
                    return ListJson();
                case "icon":
                    if (rest.Length == 0) throw new ArgumentException("usage: icon <name>");
                    return "{\"type\":\"icon\",\"name\":" + Json(rest) + ",\"png\":" + Json(GetIcon(rest)) + "}";
                case "set":
                {
                    string name, value;
                    if (!SplitNameValue(rest, out name, out value)) throw new ArgumentException("usage: set <name> <0-100>");
                    float v = float.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
                    v = Math.Max(0f, Math.Min(100f, v)) / 100f;
                    int n = 0;
                    foreach (var s in Collect()) if (Match(s, name)) foreach (var vol in s.Volumes) { vol.SetMasterVolume(v, ref EmptyGuid); n++; }
                    return "{\"type\":\"ok\",\"count\":" + n + "}";
                }
                case "mute":
                {
                    string name, value;
                    if (!SplitNameValue(rest, out name, out value)) throw new ArgumentException("usage: mute <name> <0|1>");
                    bool m = value == "1" || value.ToLowerInvariant() == "true";
                    int n = 0;
                    foreach (var s in Collect()) if (Match(s, name)) foreach (var vol in s.Volumes) { vol.SetMute(m, ref EmptyGuid); n++; }
                    return "{\"type\":\"ok\",\"count\":" + n + "}";
                }
                default:
                    throw new ArgumentException("unknown command: " + cmd);
            }
        }

        /// <summary>Splits "&lt;name with spaces&gt; &lt;value&gt;" at the LAST space.</summary>
        static bool SplitNameValue(string rest, out string name, out string value)
        {
            name = null; value = null;
            int i = rest.LastIndexOf(' ');
            if (i <= 0) return false;
            name = rest.Substring(0, i).Trim();
            value = rest.Substring(i + 1).Trim();
            return name.Length > 0 && value.Length > 0;
        }

        static bool Match(AppSession s, string name)
        {
            return string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase);
        }

        static string ListJson()
        {
            var sb = new StringBuilder("{\"type\":\"sessions\",\"sessions\":[");
            bool first = true;
            foreach (var s in Collect())
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"name\":").Append(Json(s.Name))
                  .Append(",\"label\":").Append(Json(s.Label))
                  .Append(",\"pid\":").Append(s.Pid)
                  .Append(",\"volume\":").Append(((int)Math.Round(s.Volume * 100)).ToString())
                  .Append(",\"muted\":").Append(s.Muted ? "true" : "false")
                  .Append(",\"active\":").Append(s.Active ? "true" : "false")
                  .Append(",\"path\":").Append(Json(s.Path))
                  .Append('}');
            }
            sb.Append("]}");
            return sb.ToString();
        }

        // Enumerates all audio sessions of all active playback devices,
        // grouping them by executable name (Chrome/Discord etc. have several sessions/processes).
        static List<AppSession> Collect()
        {
            var byName = new Dictionary<string, AppSession>(StringComparer.OrdinalIgnoreCase);
            var order = new List<AppSession>();
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDeviceCollection devices;
            if (enumerator.EnumAudioEndpoints(EDataFlow.eRender, 1 /* DEVICE_STATE_ACTIVE */, out devices) != 0) return order;
            int devCount;
            devices.GetCount(out devCount);
            Guid iidManager = typeof(IAudioSessionManager2).GUID;
            for (int d = 0; d < devCount; d++)
            {
                IMMDevice device;
                if (devices.Item(d, out device) != 0) continue;
                object o;
                if (device.Activate(ref iidManager, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o) != 0) continue;
                var manager = (IAudioSessionManager2)o;
                IAudioSessionEnumerator sessions;
                if (manager.GetSessionEnumerator(out sessions) != 0) continue;
                int count;
                sessions.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl2 ctl;
                    if (sessions.GetSession(i, out ctl) != 0) continue;
                    AudioSessionState state;
                    ctl.GetState(out state);
                    if (state == AudioSessionState.Expired) continue;
                    uint pid;
                    ctl.GetProcessId(out pid);
                    bool isSystem = ctl.IsSystemSoundsSession() == 0; // S_OK = this is the system sounds session

                    string name, label, path;
                    if (isSystem)
                    {
                        name = "system"; label = "System sounds"; path = null;
                        // icon: the one of the Windows volume mixer
                        PathByName[name] = System.IO.Path.Combine(Environment.SystemDirectory, "SndVol.exe");
                    }
                    else
                    {
                        string[] info = ProcessInfo(pid);
                        if (info == null) continue; // process has ended
                        name = info[0]; label = info[1]; path = info[2];
                    }

                    var vol = ctl as ISimpleAudioVolume;
                    if (vol == null) continue;
                    float level; bool mute;
                    vol.GetMasterVolume(out level);
                    vol.GetMute(out mute);

                    AppSession s;
                    if (!byName.TryGetValue(name, out s))
                    {
                        s = new AppSession { Name = name, Label = label, Path = path, Pid = pid, Volume = level, Muted = mute };
                        byName[name] = s;
                        order.Add(s);
                        if (path != null) PathByName[name] = path;
                    }
                    else
                    {
                        // for groups show the highest volume, and "muted" only if all of them are
                        s.Volume = Math.Max(s.Volume, level);
                        s.Muted = s.Muted && mute;
                    }
                    if (state == AudioSessionState.Active) s.Active = true;
                    s.Volumes.Add(vol);
                }
            }
            return order;
        }

        // Returns [name, label, path] for a PID, cached.
        static string[] ProcessInfo(uint pid)
        {
            string[] cached;
            if (ProcInfoCache.TryGetValue(pid, out cached))
            {
                // make sure the PID has not been recycled
                try { if (Process.GetProcessById((int)pid).ProcessName.Equals(cached[3], StringComparison.OrdinalIgnoreCase)) return cached; }
                catch { }
                ProcInfoCache.Remove(pid);
            }
            string procName;
            try { procName = Process.GetProcessById((int)pid).ProcessName; }
            catch { return null; }

            string path = null;
            IntPtr h = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h != IntPtr.Zero)
            {
                var sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (Native.QueryFullProcessImageName(h, 0, sb, ref size)) path = sb.ToString();
                Native.CloseHandle(h);
            }

            string label = procName;
            if (path != null)
            {
                try
                {
                    var fvi = FileVersionInfo.GetVersionInfo(path);
                    if (!string.IsNullOrWhiteSpace(fvi.FileDescription)) label = fvi.FileDescription.Trim();
                    else if (!string.IsNullOrWhiteSpace(fvi.ProductName)) label = fvi.ProductName.Trim();
                }
                catch { }
            }

            var result = new[] { procName.ToLowerInvariant(), label, path, procName };
            ProcInfoCache[pid] = result;
            return result;
        }

        // Extracts the icon of the executable (128px if available) and returns it as a base64 PNG.
        static string GetIcon(string name)
        {
            string cached;
            if (IconCache.TryGetValue(name, out cached)) return cached;
            string path;
            if (!PathByName.TryGetValue(name, out path))
            {
                Collect(); // fills PathByName
                PathByName.TryGetValue(name, out path);
            }
            string png = null;
            if (path != null && File.Exists(path))
            {
                png = ExtractPng(path, 128) ?? ExtractPng(path, 64) ?? ExtractAssociated(path);
            }
            IconCache[name] = png;
            return png;
        }

        static string ExtractPng(string path, int size)
        {
            var icons = new IntPtr[1];
            var ids = new uint[1];
            uint got = Native.PrivateExtractIcons(path, 0, size, size, icons, ids, 1, 0);
            if (got == 0 || got == 0xFFFFFFFF || icons[0] == IntPtr.Zero) return null;
            try
            {
                using (var icon = Icon.FromHandle(icons[0]))
                using (var bmp = icon.ToBitmap())
                    return ToBase64(bmp);
            }
            catch { return null; }
            finally { Native.DestroyIcon(icons[0]); }
        }

        static string ExtractAssociated(string path)
        {
            try
            {
                using (var icon = Icon.ExtractAssociatedIcon(path))
                {
                    if (icon == null) return null;
                    using (var bmp = icon.ToBitmap()) return ToBase64(bmp);
                }
            }
            catch { return null; }
        }

        static string ToBase64(Bitmap bmp)
        {
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            }
        }

        static string Json(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
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
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }
    }
}
