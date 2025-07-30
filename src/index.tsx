import { useRef, useState } from "react";

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
import { SORT_OPTIONS } from "./constants";
import { ThemeProvider } from "./context/theme-context";
import useAppState from "./hooks/use-app-state";

const App = () => {
  // Use our main app state hook
  const appState = useAppState();
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const sidebarRef = useRef<SidebarRef>(null);
  
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
          currentWorkspace={appState.currentWorkspace}
          saveCurrentWorkspace={appState.saveCurrentWorkspace}
          headerSaveState={appState.headerSaveState}
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
            searchTerm={appState.searchTerm}
            onSearchChange={appState.handleSearchChange}
            selectAllFiles={() => appState.selectAllFiles(appState.displayedFiles)}
            deselectAllFiles={() => appState.deselectAllFiles(appState.displayedFiles)}
            expandedNodes={appState.expandedNodes}
            toggleExpanded={appState.toggleExpanded}
            resetFolderState={appState.handleResetFolderState}
            onFileTreeSortChange={appState.handleFileTreeSortChange}
            toggleFilterModal={appState.toggleFilterModal}
            refreshFileTree={appState.handleRefreshFileTree}
            onViewFile={appState.openFileViewModal}
            processingStatus={appState.processingStatus}
            loadFileContent={appState.loadFileContent}
          />
          
          <ContentArea 
            selectedFiles={appState.selectedFiles}
            allFiles={appState.allFiles}
            toggleFileSelection={appState.toggleFileSelection}
            toggleSelection={appState.toggleSelection}
            openFolder={appState.openFolder}
            onViewFile={appState.openFileViewModal}
            processingStatus={appState.processingStatus}
            selectedSystemPrompts={appState.selectedSystemPrompts}
            toggleSystemPromptSelection={appState.toggleSystemPromptSelection}
            selectedRolePrompts={appState.selectedRolePrompts}
            toggleRolePromptSelection={appState.toggleRolePromptSelection}
            sortOrder={appState.sortOrder}
            handleSortChange={appState.handleSortChange}
            sortDropdownOpen={appState.sortDropdownOpen}
            toggleSortDropdown={appState.toggleSortDropdown}
            sortOptions={SORT_OPTIONS}
            getSelectedFilesContent={appState.getFormattedContent}
            calculateTotalTokens={appState.calculateTotalTokens}
            instructionsTokenCount={appState.instructionsTokenCount}
            userInstructions={appState.userInstructions}
            setUserInstructions={appState.setUserInstructions}
            fileTreeTokens={appState.getCurrentFileTreeTokens()}
            systemPromptTokens={appState.systemPromptsTokens}
            rolePromptTokens={appState.rolePromptsTokens}
            setSystemPromptsModalOpen={appState.setSystemPromptsModalOpen}
            setRolePromptsModalOpen={appState.setRolePromptsModalOpen}
            setInstructionsModalOpen={appState.setInstructionsModalOpen}
            loadFileContent={appState.loadFileContent}
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
        
        <SystemPromptsModal
          isOpen={appState.systemPromptsModalOpen}
          onClose={() => appState.setSystemPromptsModalOpen(false)}
          systemPrompts={appState.systemPrompts}
          onAddPrompt={appState.handleAddSystemPrompt}
          onDeletePrompt={appState.handleDeleteSystemPrompt}
          onUpdatePrompt={appState.handleUpdateSystemPrompt}
          onSelectPrompt={appState.toggleSystemPromptSelection}
          selectedSystemPrompts={appState.selectedSystemPrompts}
          toggleSystemPromptSelection={appState.toggleSystemPromptSelection}
        />
        
        <RolePromptsModal
          isOpen={appState.rolePromptsModalOpen}
          onClose={() => appState.setRolePromptsModalOpen(false)}
          rolePrompts={appState.rolePrompts}
          onAddPrompt={appState.handleAddRolePrompt}
          onDeletePrompt={appState.handleDeleteRolePrompt}
          onUpdatePrompt={appState.handleUpdateRolePrompt}
          onSelectPrompt={appState.toggleRolePromptSelection}
          selectedRolePrompts={appState.selectedRolePrompts}
          toggleRolePromptSelection={appState.toggleRolePromptSelection}
        />
        
        <InstructionsModal
          isOpen={appState.instructionsModalOpen}
          onClose={() => appState.setInstructionsModalOpen(false)}
          instructions={appState.instructions || []}
          onAddInstruction={appState.onAddInstruction}
          onDeleteInstruction={appState.onDeleteInstruction}
          onUpdateInstruction={appState.onUpdateInstruction}
          selectedInstructions={appState.selectedInstructions || []}
          toggleInstructionSelection={appState.toggleInstructionSelection}
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
