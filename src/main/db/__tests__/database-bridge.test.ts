import { app as electronApp } from 'electron';

jest.mock('better-sqlite3');

import { DatabaseBridge } from '../database-bridge';
import { PasteFlowDatabase } from '../database-implementation';

const originalVersions = process.versions;

afterAll(() => {
  Object.defineProperty(process, 'versions', {
    value: originalVersions,
    configurable: true,
    writable: true,
  });
});

describe('DatabaseBridge initialization contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      configurable: true,
      writable: true,
    });
  });

  it('fails fast when Electron runtime is unavailable', async () => {
    Object.defineProperty(process, 'versions', {
      value: { ...originalVersions, electron: undefined },
      configurable: true,
      writable: true,
    });

    const bridge = new DatabaseBridge();

    await expect(bridge.initialize(1, 1)).rejects.toThrow(
      /better-sqlite3 must be loaded from electron main process/i
    );
    expect(bridge.initialized).toBe(false);
  });

  it('initializes once when Electron runtime is present', async () => {
    Object.defineProperty(process, 'versions', {
      value: { ...originalVersions, electron: '34.3.0' },
      configurable: true,
      writable: true,
    });

    const initSpy = jest
      .spyOn(PasteFlowDatabase.prototype, 'initializeDatabase')
      .mockResolvedValue();
    const closeSpy = jest
      .spyOn(PasteFlowDatabase.prototype, 'close')
      .mockImplementation(() => {});
    const getPathSpy = jest
      .spyOn(electronApp, 'getPath')
      .mockReturnValue('/tmp/pasteflow-test');

    const bridge = new DatabaseBridge();

    await expect(bridge.initialize()).resolves.toBeUndefined();
    expect(bridge.initialized).toBe(true);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(getPathSpy).toHaveBeenCalledWith('userData');

    // Subsequent initialize calls are no-ops
    await expect(bridge.initialize()).resolves.toBeUndefined();
    expect(initSpy).toHaveBeenCalledTimes(1);

    await bridge.close();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('throws when accessing operations before initialization', async () => {
    const bridge = new DatabaseBridge();

    await expect(bridge.listWorkspaces()).rejects.toThrow('Database not initialized');
    await expect(bridge.createWorkspace('name', '/tmp', {})).rejects.toThrow('Database not initialized');
    await expect(bridge.getWorkspace('name')).rejects.toThrow('Database not initialized');
  });
});

describe('DatabaseBridge cleanup contract', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'versions', {
      value: { ...originalVersions, electron: '34.3.0' },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      configurable: true,
      writable: true,
    });
  });

  it('handles close on an uninitialized bridge', async () => {
    const bridge = new DatabaseBridge();
    await expect(bridge.close()).resolves.toBeUndefined();
  });

  it('propagates errors from the underlying database close', async () => {
    jest
      .spyOn(PasteFlowDatabase.prototype, 'initializeDatabase')
      .mockResolvedValue();

    const closeSpy = jest
      .spyOn(PasteFlowDatabase.prototype, 'close')
      .mockImplementation(() => {
        throw new Error('close failure');
      });

    const bridge = new DatabaseBridge();
    await bridge.initialize();

    await expect(bridge.close()).rejects.toThrow('close failure');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
