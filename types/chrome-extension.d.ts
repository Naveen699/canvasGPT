export {};

type ChromeCallback<T = any> = (response: T) => void;

declare global {
  const chrome: {
    contextMenus: {
      create(options: Record<string, any>): void;
      onClicked: {
        addListener(callback: (info: any, tab?: any) => void): void;
      };
      remove(id: string): Promise<void>;
    };
    runtime: {
      lastError?: { message?: string };
      onInstalled: {
        addListener(callback: () => void): void;
      };
      onMessage: {
        addListener(
          callback: (message: any, sender: any, sendResponse: ChromeCallback) => boolean | void
        ): void;
      };
      sendMessage(message: any, callback: ChromeCallback): void;
    };
    scripting: {
      executeScript(options: Record<string, any>): Promise<Array<{ result?: any }>>;
    };
    sidePanel: {
      open(options: Record<string, any>): Promise<void>;
      setPanelBehavior(options: Record<string, any>): Promise<void>;
    };
    tabs: {
      query(options: Record<string, any>): Promise<any[]>;
      sendMessage(tabId: number, message: any, callback: ChromeCallback): void;
    };
  };

  const CanvasDetection: any;
  const CanvasDomainSettings: any;

  interface Window {
    CanvasDetection?: any;
    CanvasSessionApi?: any;
  }
}
