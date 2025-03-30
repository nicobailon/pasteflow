import { useState } from "react";

import AppHeader from "./components/app-header";
import { ApplyChangesModal } from "./components/apply-changes-modal";
import ContentArea from "./components/content-area";
import DocsModal from "./components/docs-modal";
import FileViewModal from "./components/file-view-modal";
import FilterModal from "./components/filter-modal";
import ProcessingIndicator from "./components/processing-indicator";
import RolePromptsModal from "./components/role-prompts-modal";
import Sidebar from "./components/sidebar";
import SystemPromptsModal from "./components/system-prompts-modal";
import WorkspaceModal from "./components/workspace-modal";
import { SORT_OPTIONS } from "./constants";
import { ThemeProvider } from "./context/theme-context";
import useAppState from "./hooks/use-app-state";

const App = () => {
  // Use our main app state hook
  const appState = useAppState();
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);

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
          toggleWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
          currentWorkspace={appState.currentWorkspace}
          saveCurrentWorkspace={appState.saveCurrentWorkspace}
          headerSaveState={appState.headerSaveState} // Pass the new state down
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
            onFileTreeSortChange={() => {}}
            toggleFilterModal={appState.toggleFilterModal}
            refreshFileTree={appState.handleRefreshFileTree}
            onViewFile={appState.openFileViewModal}
            processingStatus={appState.processingStatus}
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
            getContentWithXmlPrompt={appState.getFormattedContentWithXml}
            calculateTotalTokens={appState.calculateTotalTokens}
            instructionsTokenCount={appState.instructionsTokenCount}
            userInstructions={appState.userInstructions}
            setUserInstructions={appState.setUserInstructions}
            fileTreeTokens={appState.getCurrentFileTreeTokens()}
            systemPromptTokens={appState.systemPromptTokens}
            rolePromptTokens={appState.rolePromptTokens}
            setShowApplyChangesModal={appState.setShowApplyChangesModal}
            setSystemPromptsModalOpen={appState.setSystemPromptsModalOpen}
            setRolePromptsModalOpen={appState.setRolePromptsModalOpen}
            setDocsModalOpen={appState.setDocsModalOpen}
          />
        </div>
        
        {/* Modals */}
        {appState.showApplyChangesModal && appState.selectedFolder && (
          <ApplyChangesModal
            selectedFolder={appState.selectedFolder}
            onClose={() => appState.setShowApplyChangesModal(false)}
          />
        )}
        
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
        
        <DocsModal
          isOpen={appState.docsModalOpen}
          onClose={() => appState.setDocsModalOpen(false)}
          docs={appState.docs}
          onAddDoc={appState.handleAddDoc}
          onDeleteDoc={appState.handleDeleteDoc}
          onUpdateDoc={appState.handleUpdateDoc}
          selectedDocs={appState.selectedDocs}
          toggleDocSelection={appState.toggleDocSelection}
        />
        
        <WorkspaceModal
          isOpen={isWorkspaceModalOpen}
          onClose={() => setIsWorkspaceModalOpen(false)}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
