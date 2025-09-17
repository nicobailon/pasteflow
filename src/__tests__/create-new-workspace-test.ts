import { act, renderHook } from "@testing-library/react";

import useAppState from "../hooks/use-app-state";
import { electronHandlerSingleton } from "../handlers/electron-handler-singleton";
import * as electronHandlers from "../handlers/electron-handlers";
import { logger } from "../utils/logger";
import { setupMockLocalStorage } from "./test-helpers";
import {
  buildWorkspaceStateFixture,
  setupWorkspaceIpcMock,
  WorkspaceIpcMock,
} from "./test-helpers/workspace-ipc-mock";

describe("createNewWorkspace event", () => {
  let ipcMock: WorkspaceIpcMock;

  beforeEach(() => {
    setupMockLocalStorage();
    ipcMock = setupWorkspaceIpcMock();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);

    jest.spyOn(electronHandlerSingleton, "isSetup").mockReturnValue(false);
    jest.spyOn(electronHandlerSingleton, "setup").mockImplementation(() => undefined);
    jest.spyOn(electronHandlerSingleton, "cleanup").mockImplementation(() => undefined);

    jest.spyOn(electronHandlers, "setupElectronHandlers").mockReturnValue(() => undefined);
    jest.spyOn(electronHandlers, "cancelFileLoading").mockReturnValue(false);
    jest.spyOn(electronHandlers, "openFolderDialog").mockReturnValue(false);
    jest
      .spyOn(electronHandlers, "requestFileContent")
      .mockResolvedValue({ success: false, error: "not-implemented" });
    jest.spyOn(electronHandlers, "setGlobalRequestId").mockImplementation(() => undefined);
  });

  afterEach(() => {
    ipcMock.restore();
    jest.restoreAllMocks();
  });

  test("clears workspace state while preserving user instructions", async () => {
    const workspaceState = buildWorkspaceStateFixture({
      userInstructions: "workspace preset",
    });
    ipcMock.setWorkspace("alpha", workspaceState);

    const { result } = renderHook(() => useAppState());

    await act(async () => {
      await result.current.loadWorkspace("alpha");
    });

    act(() => {
      result.current.setSelectionState([{ path: "file.ts" }]);
      result.current.toggleExpanded("/folder");
      result.current.setUserInstructions("manual override");
    });

    expect(result.current.currentWorkspace).toBe("alpha");
    expect(result.current.selectedFiles).toHaveLength(1);
    expect(result.current.expandedNodes["/folder"]).toBe(true);
    expect(result.current.userInstructions).toBe("manual override");

    act(() => {
      window.dispatchEvent(new Event("createNewWorkspace"));
    });

    expect(result.current.currentWorkspace).toBeNull();
    expect(result.current.selectedFiles).toEqual([]);
    expect(result.current.expandedNodes).toEqual({});
    expect(result.current.userInstructions).toBe("manual override");
  });
});
