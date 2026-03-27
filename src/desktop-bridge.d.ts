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

  type DesktopCapabilities = {
    screenshotStrictModeAvailable: boolean;
    screenRecordingPermissionStatus: ScreenPermissionStatus;
    appStoreBuild: boolean;
  };

  type VisionCaptureOptions = {
    maxDimension?: number;
    format?: "jpeg" | "png";
    quality?: number;
  };

  type VisionCapturePayload = {
    ok: boolean;
    mimeType: string;
    imageBase64: string;
    width: number;
    height: number;
  };

  type MiniWindowState = {
    active: boolean;
    taskTitle: string;
    timeLabel: string;
    durationLabel: string;
    progressRatio: number;
    phase: "idle" | "running" | "paused" | "completed";
    pinned: boolean;
    themeMode: "mono" | "mist";
    appearance: "light" | "dark";
  };

  type MiniCommand = "pause" | "resume" | "stop" | "done" | "toggle-pin";

  interface Window {
    desktopBridge?: {
      isDesktop: boolean;
      getDesktopCapabilities: () => Promise<DesktopCapabilities>;
      getMiniAlwaysOnTop: () => Promise<boolean>;
      setMiniAlwaysOnTop: (shouldPin: boolean) => Promise<boolean>;
      getScreenPermissionStatus: () => Promise<ScreenPermissionStatus>;
      requestScreenPermission: () => Promise<ScreenPermissionStatus>;
      openScreenPermissionSettings: () => Promise<boolean>;
      captureVisionFrame: (options?: VisionCaptureOptions) => Promise<VisionCapturePayload>;
      updateMiniState: (state: MiniWindowState) => void;
      getMiniState: () => Promise<MiniWindowState>;
      sendMiniControl: (command: MiniCommand) => void;
      onMiniState: (callback: (state: MiniWindowState) => void) => () => void;
      onMiniCommand: (callback: (command: MiniCommand) => void) => () => void;
    };
  }
}
