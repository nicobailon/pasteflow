import React from "react";
import { ThemeProvider } from "./context/theme-context";
import Sidebar from "./components/sidebar";
import AppHeader from "./components/app-header";
import ContentArea from "./components/content-area";
import WelcomeScreen from "./components/welcome-screen";
import ProcessingIndicator from "./components/processing-indicator";
import { ApplyChangesModal } from "./components/apply-changes-modal";
import FilterModal from "./components/filter-modal";
import SystemPromptsModal from "./components/system-prompts-modal";
import RolePromptsModal from "./components/role-prompts-modal";
import FileViewModal from "./components/file-view-modal";
import DocsModal from "./components/docs-modal";
import WorkspaceModal from "./components/workspace-modal";
import useAppState from "./hooks/use-app-state";
import { SORT_OPTIONS } from "./constants";

const App = () => {
  // Use our main app state hook
  const appState = useAppState();
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = React.useState(false);

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

  // Show welcome screen if app not initialized or no folder selected
  if (!appState.appInitialized || !appState.selectedFolder) {
    return (
      <ThemeProvider>
        <div className="app-container">
          <WelcomeScreen openFolder={appState.openFolder} />
        </div>
      </ThemeProvider>
    );
  }

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
          onSelectDoc={appState.toggleDocSelection}
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