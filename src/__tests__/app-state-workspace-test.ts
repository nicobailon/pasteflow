import { act, renderHook, waitFor } from "@testing-library/react";

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

describe("useAppState workspace integration", () => {
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

  test("loadWorkspace requests file metadata for persisted folders", async () => {
    const workspaceState = buildWorkspaceStateFixture({
      selectedFolder: "/tmp/project",
    });
    ipcMock.setWorkspace("alpha", workspaceState, { folderPath: "/tmp/project" });

    const { result } = renderHook(() => useAppState());

    await act(async () => {
      await result.current.loadWorkspace("alpha");
    });

    await waitFor(() => {
      expect(result.current.currentWorkspace).toBe("alpha");
      expect(result.current.selectedFolder).toBe("/tmp/project");
    });
    expect(ipcMock.ipcRenderer.send).toHaveBeenCalledWith(
      "request-file-list",
      "/tmp/project",
      expect.any(Array),
      expect.any(String)
    );
  });

  test.each([
    [{ deleted: "alpha", wasCurrent: true }, null],
    [{ deleted: "other", wasCurrent: true }, "alpha"],
    [{ deleted: "alpha", wasCurrent: false }, "alpha"],
  ])("workspacesChanged detail %o updates current workspace", async (detail, expected) => {
    ipcMock.setWorkspace("alpha", buildWorkspaceStateFixture());

    const { result } = renderHook(() => useAppState());

    await act(async () => {
      await result.current.loadWorkspace("alpha");
    });

    act(() => {
      const event = new CustomEvent("workspacesChanged", { detail });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(result.current.currentWorkspace).toBe(expected);
    });

  });

  test("saveWorkspace persists snapshot via IPC", async () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.setSelectionState([{ path: "file.ts" }]);
      result.current.toggleExpanded("/folder");
      result.current.setUserInstructions("Remember this");
    });

    await waitFor(() => {
      expect(result.current.selectedFiles).toHaveLength(1);
    });

    await act(async () => {
      await result.current.saveWorkspace("delta");
    });

    const persisted = ipcMock.getWorkspace("delta");
    expect(persisted).toBeDefined();
    expect(persisted?.state.selectedFiles).toEqual([{ path: "file.ts" }]);
    expect(persisted?.state.expandedNodes["/folder"]).toBe(true);
    expect(persisted?.state.userInstructions).toBe("Remember this");
  });
});
