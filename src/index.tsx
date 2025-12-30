import { useRef, useState, useEffect } from "react";

import { SORT_OPTIONS } from "@constants";

import AppHeader from "./components/app-header";
import ContentArea from "./components/content-area";
import InstructionsModal from "./components/instructions-modal";
import FileViewModal from "./components/file-view-modal";
import FilterModal from "./components/filter-modal";
import ProcessingIndicator from "./components/processing-indicator";
import RolePromptsModal from "./components/role-prompts-modal";
import Sidebar, { SidebarRef } from "./components/sidebar";
import SystemPromptsModal from "./components/system-prompts-modal";
import WorkspaceModal from "./components/workspace-modal";
import { ThemeProvider } from "./context/theme-context";
import useAppState from "./hooks/use-app-state";
import { useUIStore, usePromptStore } from "./stores";
import { initializeCacheRegistry } from "./utils/cache-registry";
import { useMemoryMonitoring } from "./hooks/use-memory-monitoring";
import { getGlobalPerformanceMonitor } from "./utils/performance-monitor";

const App = () => {
  const appState = useAppState();

  const selectedSystemPrompts = usePromptStore((s) => s.selectedSystemPrompts);
  const selectedRolePrompts = usePromptStore((s) => s.selectedRolePrompts);
  const toggleSystemPromptSelection = usePromptStore((s) => s.toggleSystemPromptSelection);
  const toggleRolePromptSelection = usePromptStore((s) => s.toggleRolePromptSelection);

  // Dev memory monitoring (register caches once on mount)
  useMemoryMonitoring();

  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const sidebarRef = useRef<SidebarRef>(null);
  
  useEffect(() => {
    return initializeCacheRegistry();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('pasteflow-prompts');
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      const state = parsed.state || {};
      if (state.systemPrompts?.length || state.rolePrompts?.length || state.userInstructions) {
        window.electron.ipcRenderer.invoke('/migrate-prompts', {
          systemPrompts: state.systemPrompts,
          rolePrompts: state.rolePrompts,
          userInstructions: state.userInstructions
        }).then((result: { success?: boolean }) => {
          if (result.success) {
            const newState = { ...state, systemPrompts: [], rolePrompts: [], userInstructions: '' };
            localStorage.setItem('pasteflow-prompts', JSON.stringify({ state: newState }));
          }
        });
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    const open = () => setIsWorkspaceModalOpen(true);
    window.addEventListener('pasteflow:open-workspaces', open);
    return () => {
      window.removeEventListener('pasteflow:open-workspaces', open);
    };
  }, []);

  // Dev-only: expose performance report helpers on window
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const monitor = getGlobalPerformanceMonitor();
      (window as any).__PF_dumpPerf = () => monitor.logReport();
      (window as any).__PF_perfStats = () => monitor.getAllStats();
      return () => {
        delete (window as any).__PF_dumpPerf;
        delete (window as any).__PF_perfStats;
      };
    }
  }, []);
  
  // Helper to close all dropdowns when opening modals
  const closeAllDropdowns = () => {
    sidebarRef.current?.closeSortDropdown();
    // Close content area sort dropdown if it's open
    if (appState.sortDropdownOpen) {
      appState.toggleSortDropdown();
    }
  };
  

  // Process error state
  if (appState.processingStatus.status === "error") {
    return (
      <ThemeProvider>
        <div className="app-container">
          <div className="error-message">Error: {appState.processingStatus.message}</div>
        </div>
      </ThemeProvider>
    );
  }

  // If the app isn't initialized or no folder is selected, render nothing or a minimal loading state.
  // For now, we'll just let it proceed to the main return block, which might need adjustment
  // depending on how the components handle the lack of a selected folder.
  // Consider adding a loading indicator or a prompt to select a folder here if needed.

  return (
    <ThemeProvider>
      <div className="app-container">
        <AppHeader 
          selectedFolder={appState.selectedFolder}
          fileTreeMode={appState.fileTreeMode}
          setFileTreeMode={appState.setFileTreeMode}
          tokenCounts={appState.fileTreeTokenCounts()}
          toggleWorkspaceModal={() => {
            closeAllDropdowns();
            setIsWorkspaceModalOpen(true);
          }}
          saveCurrentWorkspace={appState.saveCurrentWorkspace}
          setAutoSaveEnabled={appState.setAutoSaveEnabled}
          appState={appState}
        />

        {/* Processing indicator overlay */}
        {appState.processingStatus.status === "processing" && (
          <ProcessingIndicator 
            status={appState.processingStatus.status}
            message={appState.processingStatus.message}
            processed={appState.processingStatus.processed}
            directories={appState.processingStatus.directories}
            total={appState.processingStatus.total}
            isLoadingCancellable={appState.isLoadingCancellable}
            onCancel={appState.handleCancelLoading}
          />
        )}

        <div className="main-content">
          <Sidebar
            ref={sidebarRef}
            selectedFolder={appState.selectedFolder}
            openFolder={appState.openFolder}
            allFiles={appState.allFiles}
            selectedFiles={appState.selectedFiles}
            toggleFileSelection={appState.toggleFileSelection}
            toggleFolderSelection={appState.toggleFolderSelection}
            selectAllFiles={() => appState.selectAllFiles(appState.displayedFiles)}
            deselectAllFiles={() => appState.deselectAllFiles(appState.displayedFiles)}
            expandedNodes={appState.expandedNodes}
            toggleExpanded={appState.toggleExpanded}
            resetFolderState={appState.handleResetFolderState}
            onFileTreeSortChange={appState.handleFileTreeSortChange}
            refreshFileTree={appState.handleRefreshFileTree}
            processingStatus={appState.processingStatus}
            loadFileContent={appState.loadFileContent}
            folderSelectionCache={appState.folderSelectionCache}
          />
          
          <ContentArea
            selectedFiles={appState.selectedFiles}
            allFiles={appState.allFiles}
            toggleFileSelection={appState.toggleFileSelection}
            toggleSelection={appState.toggleSelection}
            openFolder={appState.openFolder}
            processingStatus={appState.processingStatus}
            folderSelectionCache={appState.folderSelectionCache}
            selectedSystemPrompts={selectedSystemPrompts}
            toggleSystemPromptSelection={toggleSystemPromptSelection}
            onViewSystemPrompt={useUIStore.getState().openSystemPromptsModalForEdit}
            selectedRolePrompts={selectedRolePrompts}
            toggleRolePromptSelection={toggleRolePromptSelection}
            onViewRolePrompt={useUIStore.getState().openRolePromptsModalForEdit}
            selectedInstructions={appState.selectedInstructions}
            toggleInstructionSelection={appState.toggleInstructionSelection}
            onViewInstruction={appState.openInstructionsModalForEdit}
            sortOptions={[...SORT_OPTIONS]}
            getSelectedFilesContent={appState.getFormattedContentFromLatest}
            calculateTotalTokens={appState.calculateTotalTokens}
            instructionsTokenCount={appState.instructionsTokenCount}
            fileTreeTokens={appState.getCurrentFileTreeTokens()}
            systemPromptTokens={appState.systemPromptsTokens}
            rolePromptTokens={appState.rolePromptsTokens}
            instructionsTokens={appState.instructionsTokens}
            loadFileContent={appState.loadFileContent}
            loadMultipleFileContents={appState.loadMultipleFileContents}
            selectedFolder={appState.selectedFolder}
            expandedNodes={appState.expandedNodes}
            toggleExpanded={appState.toggleExpanded}
            fileTreeMode={appState.fileTreeMode}
            clearAllSelections={appState.clearAllSelections}
            toggleFolderSelection={appState.toggleFolderSelection}
          />
        </div>
        
        {/* Modals */}
        {appState.filterModalOpen && (
          <FilterModal
            exclusionPatterns={appState.exclusionPatterns}
            onSave={(patterns: string[]) => {
              appState.setExclusionPatterns(patterns);
              appState.setFilterModalOpen(false);
              appState.handleRefreshFileTree();
            }}
            onClose={() => appState.setFilterModalOpen(false)}
          />
        )}

        <FileViewModal
          isOpen={appState.fileViewModalOpen}
          onClose={appState.closeFileViewModal}
          filePath={appState.currentViewedFilePath}
          allFiles={appState.allFiles}
          selectedFile={appState.findSelectedFile(appState.currentViewedFilePath)}
          onUpdateSelectedFile={appState.updateSelectedFile}
          loadFileContent={appState.loadFileContent}
        />
        
        <SystemPromptsModal />
        
        <RolePromptsModal />
        
        <InstructionsModal
          isOpen={appState.instructionsModalOpen}
          onClose={() => appState.closeInstructionsModal()}
          instructions={appState.instructions || []}
          onAddInstruction={appState.onAddInstruction}
          onDeleteInstruction={appState.onDeleteInstruction}
          onUpdateInstruction={appState.onUpdateInstruction}
          selectedInstructions={appState.selectedInstructions || []}
          toggleInstructionSelection={appState.toggleInstructionSelection}
          initialEditInstruction={appState.instructionToEdit}
        />
        
        <WorkspaceModal
          isOpen={isWorkspaceModalOpen}
          onClose={() => setIsWorkspaceModalOpen(false)}
          appState={appState}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
