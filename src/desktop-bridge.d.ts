export {};

declare global {
  type ScreenPermissionStatus =
    | "granted"
    | "denied"
    | "restricted"
    | "not-determined"
    | "unknown"
    | "unsupported";

  type DesktopActiveContext = {
    appName: string;
    windowTitle: string;
    url: string;
  };

  type MiniWindowState = {
    active: boolean;
    taskTitle: string;
    timeLabel: string;
    durationLabel: string;
    progressRatio: number;
    phase: "idle" | "running" | "paused" | "completed";
    pinned: boolean;
  };

  type MiniCommand = "pause" | "resume" | "stop" | "toggle-pin";

  interface Window {
    desktopBridge?: {
      isDesktop: boolean;
      getMiniAlwaysOnTop: () => Promise<boolean>;
      setMiniAlwaysOnTop: (shouldPin: boolean) => Promise<boolean>;
      getScreenPermissionStatus: () => Promise<ScreenPermissionStatus>;
      openScreenPermissionSettings: () => Promise<boolean>;
      getActiveContext: () => Promise<DesktopActiveContext>;
      updateMiniState: (state: MiniWindowState) => void;
      getMiniState: () => Promise<MiniWindowState>;
      sendMiniControl: (command: MiniCommand) => void;
      onMiniState: (callback: (state: MiniWindowState) => void) => () => void;
      onMiniCommand: (callback: (command: MiniCommand) => void) => () => void;
    };
  }
}
