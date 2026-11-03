// Build with the .NET Framework compiler shipped with Windows 10/11.
// This process owns the exclusive guard AND the Job. EOF is a cleanup request:
// descendants are confirmed dead before the guard handle is released.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class WindowsHost
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint HANDLE_FLAG_INHERIT = 1;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint WAIT_OBJECT_0 = 0;
    const uint WAIT_FAILED = 0xffffffff;
    const uint INFINITE = 0xffffffff;
    static readonly object Gate = new object();
    static readonly object OutputGate = new object();
    static readonly JavaScriptSerializer Writer = new JavaScriptSerializer();
    static IntPtr Job;
    static string JobName;
    static FileStream Guard;
    static RunState Active;
    static bool ShuttingDown;
    static volatile bool OutputBroken;

    sealed class RunState
    {
        internal int Id;
        internal string Command;
        internal string[] Args;
        internal string Cwd;
        internal SortedDictionary<string, string> Env;
        internal int TimeoutMs;
        internal bool Cancel;
        internal bool Assigned;
        internal Thread Worker;
    }

    static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        // Only the explicitly created child stdio pipe ends may be inherited.
        // In particular, descendants must never inherit the parent's input pipe.
        for (int number = -10; number >= -12; number--)
        {
            IntPtr standard = GetStdHandle(number);
            if (standard != IntPtr.Zero && standard != new IntPtr(-1))
                SetHandleInformation(standard, HANDLE_FLAG_INHERIT, 0);
        }
        try
        {
            JavaScriptSerializer reader = new JavaScriptSerializer();
            reader.MaxJsonLength = 4 * 1024 * 1024;
            string first = Console.ReadLine();
            if (first == null) return 0;
            Dictionary<string, object> open = Parse(reader, first);
            if (Text(open, "op") != "open") throw new InvalidOperationException();
            string file = OptionalText(open, "file");
            int waitMs = Number(open, "waitMs", 0);
            if (file != null && !Acquire(file, waitMs))
            {
                Emit(new { type = "error", reason = "busy" });
                return 73;
            }
            int admission = InspectGuard();
            if (admission != 0)
            {
                Emit(new { type = "error", reason = admission == 73 ? "busy" : "uncertain" });
                return admission;
            }
            JobName = "Local\\ContentOps." + Guid.NewGuid().ToString("N");
            Job = CreateJobObject(IntPtr.Zero, JobName);
            if (Job == IntPtr.Zero) throw new Win32Exception();
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(Job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
                throw new Win32Exception();
            WriteGuard("idle");
            Emit(new { type = "ready" });
            string line;
            while (!OutputBroken && (line = Console.ReadLine()) != null)
            {
                Dictionary<string, object> message = Parse(reader, line);
                string operation = Text(message, "op");
                if (operation == "close") break;
                if (operation == "stop")
                {
                    lock (Gate)
                    {
                        if (Active != null && Active.Id == Number(message, "id", -1)) Stop(Active);
                    }
                }
                else if (operation == "run")
                {
                    RunState state = Request(message);
                    lock (Gate)
                    {
                        if (ShuttingDown || Active != null) throw new InvalidOperationException();
                        Active = state;
                        state.Worker = new Thread(delegate() { Run(state); });
                        state.Worker.Start();
                    }
                }
                else throw new InvalidOperationException();
            }
            return 0;
        }
        catch
        {
            // Do not include exception messages: they can contain paths, argv or environment.
            Emit(new { type = "error", reason = "unavailable" });
            return 74;
        }
        finally
        {
            Thread worker = null;
            lock (Gate)
            {
                ShuttingDown = true;
                if (Active != null) { Stop(Active); worker = Active.Worker; }
            }
            if (worker != null) worker.Join();
            if (Job != IntPtr.Zero)
            {
                EmptyJob();
                CloseHandle(Job);
                Job = IntPtr.Zero;
            }
            if (Guard != null) Guard.Dispose();
        }
    }

    static Dictionary<string, object> Parse(JavaScriptSerializer reader, string line)
    {
        if (line.Length > 4 * 1024 * 1024) throw new InvalidOperationException();
        Dictionary<string, object> result = reader.DeserializeObject(line) as Dictionary<string, object>;
        if (result == null) throw new InvalidOperationException();
        return result;
    }

    static bool Acquire(string file, int waitMs)
    {
        Stopwatch elapsed = Stopwatch.StartNew();
        for (;;)
        {
            try
            {
                Guard = new FileStream(file, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.None);
                return true;
            }
            catch (IOException error)
            {
                int code = Marshal.GetHRForException(error) & 0xffff;
                if (code != 32 && code != 33) throw;
                if (elapsed.ElapsedMilliseconds >= waitMs) return false;
                Thread.Sleep((int)Math.Max(1, Math.Min(25, waitMs - elapsed.ElapsedMilliseconds)));
            }
        }
    }

    static int InspectGuard()
    {
        if (Guard == null || Guard.Length == 0) return 0;
        IntPtr oldJob = IntPtr.Zero;
        try
        {
            if (Guard.Length > 4096) return 74;
            byte[] bytes = new byte[(int)Guard.Length];
            Guard.Position = 0;
            int offset = 0;
            while (offset < bytes.Length)
            {
                int count = Guard.Read(bytes, offset, bytes.Length - offset);
                if (count == 0) return 74;
                offset += count;
            }
            Dictionary<string, object> record = Parse(new JavaScriptSerializer(), Encoding.UTF8.GetString(bytes));
            if (Number(record, "version", 0) != 1) return 74;
            string name = Text(record, "job");
            const string prefix = "Local\\ContentOps.";
            Guid identifier;
            if (!name.StartsWith(prefix, StringComparison.Ordinal) || !Guid.TryParseExact(name.Substring(prefix.Length), "N", out identifier)) return 74;
            string phase = Text(record, "phase");
            if (phase == "idle") return 0;
            if (phase != "active") return 74;
            // KILL_ON_JOB_CLOSE can finish asynchronously after a hard guardian
            // crash. An exclusive file handle alone therefore proves nothing.
            // A missing/unqueryable named Job is ambiguous, not evidence of exit.
            oldJob = OpenJobObject(0x0004, false, name);
            if (oldJob == IntPtr.Zero) return 74;
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
            if (!QueryInformationJobObject(oldJob, 1, out accounting, (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero)) return 74;
            return accounting.ActiveProcesses == 0 ? 0 : 73;
        }
        catch { return 74; }
        finally { Close(ref oldJob); }
    }

    static void WriteGuard(string phase)
    {
        if (Guard == null) return;
        byte[] bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new { version = 1, phase = phase, job = JobName }));
        Guard.Position = 0;
        Guard.Write(bytes, 0, bytes.Length);
        Guard.SetLength(bytes.Length);
        Guard.Flush(true);
    }

    static RunState Request(Dictionary<string, object> message)
    {
        RunState state = new RunState();
        state.Id = Number(message, "id", -1);
        state.Command = Text(message, "command");
        state.Cwd = OptionalText(message, "cwd") ?? Environment.CurrentDirectory;
        state.TimeoutMs = Number(message, "timeoutMs", 90000);
        object value;
        object[] args = message.TryGetValue("args", out value) ? value as object[] : null;
        Dictionary<string, object> env = message.TryGetValue("env", out value) ? value as Dictionary<string, object> : null;
        if (state.Id < 0 || args == null || env == null) throw new InvalidOperationException();
        state.Args = new string[args.Length];
        for (int index = 0; index < args.Length; index++)
        {
            string arg = args[index] as string;
            if (arg == null || arg.IndexOf('\0') >= 0) throw new InvalidOperationException();
            state.Args[index] = arg;
        }
        state.Env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (KeyValuePair<string, object> entry in env)
        {
            string text = entry.Value as string;
            if (entry.Key.Length == 0 || entry.Key.IndexOf('=') >= 0 || entry.Key.IndexOf('\0') >= 0 || text == null || text.IndexOf('\0') >= 0)
                throw new InvalidOperationException();
            state.Env[entry.Key] = text;
        }
        return state;
    }

    static void Stop(RunState state)
    {
        state.Cancel = true;
        if (state.Assigned) TerminateJobObject(Job, 1);
    }

    static void Run(RunState state)
    {
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        IntPtr outRead = IntPtr.Zero, outWrite = IntPtr.Zero, errRead = IntPtr.Zero, errWrite = IntPtr.Zero;
        IntPtr input = IntPtr.Zero, environment = IntPtr.Zero;
        Thread outPump = null, errPump = null;
        uint exitCode = 1;
        string reason = null;
        try
        {
            string executable = ResolveExecutable(state);
            StringBuilder commandLine = new StringBuilder(Quote(executable));
            foreach (string arg in state.Args) commandLine.Append(' ').Append(Quote(arg));
            if (commandLine.Length >= 32767) throw new InvalidOperationException();
            environment = EnvironmentBlock(state.Env);
            SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
            security.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            security.bInheritHandle = true;
            if (!CreatePipe(out outRead, out outWrite, ref security, 0) || !CreatePipe(out errRead, out errWrite, ref security, 0))
                throw new Win32Exception();
            if (!SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0) || !SetHandleInformation(errRead, HANDLE_FLAG_INHERIT, 0))
                throw new Win32Exception();
            input = CreateFile("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
            if (input == new IntPtr(-1)) { input = IntPtr.Zero; throw new Win32Exception(); }
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = input; startup.hStdOutput = outWrite; startup.hStdError = errWrite;
            lock (Gate)
            {
                if (ShuttingDown || state.Cancel) { reason = "cancelled"; return; }
                // Flush before creating even a suspended child. A hard guardian
                // kill must never leave an idle marker while its Job has work.
                WriteGuard("active");
                if (!CreateProcess(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                    CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW, environment, state.Cwd, ref startup, out process))
                    throw new Win32Exception();
                // The initial thread never executes until this assignment succeeds.
                if (!AssignProcessToJobObject(Job, process.hProcess)) throw new Win32Exception();
                state.Assigned = true;
                Emit(new { type = "spawned", id = state.Id, pid = process.dwProcessId });
                if (state.Cancel || ShuttingDown) { reason = "cancelled"; TerminateJobObject(Job, 1); }
                else if (ResumeThread(process.hThread) == 0xffffffff) throw new Win32Exception();
            }
            Close(ref outWrite); Close(ref errWrite); Close(ref input);
            outPump = Pump(outRead, state.Id, "stdout"); outRead = IntPtr.Zero;
            errPump = Pump(errRead, state.Id, "stderr"); errRead = IntPtr.Zero;
            Stopwatch elapsed = Stopwatch.StartNew();
            for (;;)
            {
                lock (Gate)
                {
                    if (state.Cancel || OutputBroken) { reason = "cancelled"; TerminateJobObject(Job, 1); }
                    else if (elapsed.ElapsedMilliseconds >= state.TimeoutMs) { reason = "timeout"; TerminateJobObject(Job, 1); }
                }
                uint status = WaitForSingleObject(process.hProcess, 10);
                if (status == WAIT_OBJECT_0) break;
                if (status == WAIT_FAILED) throw new Win32Exception();
            }
            if (!GetExitCodeProcess(process.hProcess, out exitCode)) throw new Win32Exception();
        }
        catch
        {
            reason = "launch_failed";
        }
        finally
        {
            // A failed assignment leaves a suspended process: stop it before any release.
            if (process.hProcess != IntPtr.Zero && !state.Assigned)
            {
                TerminateProcess(process.hProcess, 1);
                WaitForSingleObject(process.hProcess, INFINITE);
            }
            // Also kills descendants when the direct process exited successfully on its own.
            EmptyJob();
            Close(ref outWrite); Close(ref errWrite); Close(ref input);
            if (outPump != null) outPump.Join();
            if (errPump != null) errPump.Join();
            Close(ref outRead); Close(ref errRead);
            Close(ref process.hThread); Close(ref process.hProcess);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            bool durable = true;
            try { WriteGuard("idle"); } catch { durable = false; }
            lock (Gate) { if (Active == state) Active = null; }
            if (durable) Emit(new { type = "result", id = state.Id, code = exitCode, reason = reason, treeStopped = true });
            else Emit(new { type = "error", reason = "uncertain" });
        }
    }

    static Thread Pump(IntPtr handle, int id, string type)
    {
        Thread reader = new Thread(delegate()
        {
            try
            {
                using (FileStream stream = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read, 12288, false))
                {
                    byte[] buffer = new byte[12288];
                    int count;
                    while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
                        Emit(new { type = type, id = id, data = Convert.ToBase64String(buffer, 0, count) });
                }
            }
            catch { OutputBroken = true; }
        });
        reader.Start();
        return reader;
    }

    static void EmptyJob()
    {
        if (Job == IntPtr.Zero) return;
        // Do not release the guard on an unverifiable cleanup. Retrying keeps the
        // account occupied rather than allowing another engine to race a survivor.
        for (;;)
        {
            TerminateJobObject(Job, 1);
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
            if (QueryInformationJobObject(Job, 1, out accounting, (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero)
                && accounting.ActiveProcesses == 0) return;
            Thread.Sleep(5);
        }
    }

    static string ResolveExecutable(RunState state)
    {
        string command = state.Command;
        List<string> directories = new List<string>();
        if (Path.IsPathRooted(command) || command.IndexOf('\\') >= 0 || command.IndexOf('/') >= 0)
            directories.Add("");
        else
        {
            directories.Add(state.Cwd);
            directories.Add(Environment.SystemDirectory);
            directories.Add(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
            string search;
            if (state.Env.TryGetValue("PATH", out search)) directories.AddRange(search.Split(';'));
        }
        foreach (string directory in directories)
        {
            string candidate = Path.GetFullPath(Path.Combine(state.Cwd, directory.Trim('"'), command));
            string extension = Path.GetExtension(candidate);
            if (extension.Length == 0)
            {
                if (File.Exists(candidate + ".exe")) return candidate + ".exe";
                if (File.Exists(candidate + ".com")) return candidate + ".com";
            }
            else if ((extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) || extension.Equals(".com", StringComparison.OrdinalIgnoreCase)) && File.Exists(candidate))
                return candidate;
        }
        throw new FileNotFoundException();
    }

    static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1).Append('"');
            else result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    static IntPtr EnvironmentBlock(SortedDictionary<string, string> env)
    {
        StringBuilder result = new StringBuilder();
        foreach (KeyValuePair<string, string> entry in env) result.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
        result.Append('\0');
        // A completely empty environment still requires a double NUL.
        if (env.Count == 0) result.Append('\0');
        return Marshal.StringToHGlobalUni(result.ToString());
    }

    static string Text(Dictionary<string, object> message, string key)
    {
        string result = OptionalText(message, key);
        if (String.IsNullOrEmpty(result)) throw new InvalidOperationException();
        return result;
    }
    static string OptionalText(Dictionary<string, object> message, string key)
    {
        object value;
        if (!message.TryGetValue(key, out value) || value == null) return null;
        string result = value as string;
        if (result == null || result.IndexOf('\0') >= 0) throw new InvalidOperationException();
        return result;
    }
    static int Number(Dictionary<string, object> message, string key, int fallback)
    {
        object value;
        int result = message.TryGetValue(key, out value) ? Convert.ToInt32(value) : fallback;
        if (result < 0) throw new InvalidOperationException();
        return result;
    }
    static void Emit(object message)
    {
        lock (OutputGate)
        {
            try { Console.WriteLine(Writer.Serialize(message)); Console.Out.Flush(); }
            catch { OutputBroken = true; }
        }
    }
    static void Close(ref IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize;
        public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute; public uint dwFlags;
        public ushort wShowWindow; public ushort cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr OpenJobObject(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFile(string file, uint access, uint share, ref SECURITY_ATTRIBUTES security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int number);
}
