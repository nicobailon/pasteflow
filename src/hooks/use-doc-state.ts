import { useCallback, useState } from 'react';

import { STORAGE_KEYS } from '@constants';

import { Doc } from '../types/file-types';

import { usePersistentState } from './use-persistent-state';

/**
 * Custom hook to manage documentation state
 * 
 * @returns {Object} Doc state and functions
 */
const useDocState = () => {
  // Docs state
  const [docs, setDocs] = usePersistentState<Doc[]>(
    STORAGE_KEYS.DOCS,
    []
  );
  const [selectedDocs, setSelectedDocs] = useState([] as Doc[]);

  // Docs management functions
  const handleAddDoc = useCallback((doc: Doc) => {
    setDocs([...docs, doc]);
  }, [docs, setDocs]);

  const handleDeleteDoc = useCallback((id: string) => {
    setDocs(docs.filter(doc => doc.id !== id));
    // Also remove from selected docs if it was selected
    setSelectedDocs((prev: Doc[]) => prev.filter((doc: Doc) => doc.id !== id));
  }, [docs, setDocs]);

  const handleUpdateDoc = useCallback((updatedDoc: Doc) => {
    setDocs(docs.map(doc => 
      doc.id === updatedDoc.id ? updatedDoc : doc
    ));
    
    // Also update in selected docs if it was selected
    setSelectedDocs((prev: Doc[]) => prev.map((doc: Doc) => 
      doc.id === updatedDoc.id ? updatedDoc : doc
    ));
  }, [docs, setDocs]);

  const toggleDocSelection = useCallback((doc: Doc) => {
    setSelectedDocs((prev: Doc[]) => {
      const isAlreadySelected = prev.some((d: Doc) => d.id === doc.id);
      
      return isAlreadySelected
        ? prev.filter((d: Doc) => d.id !== doc.id)
        : [...prev, doc];
    });
  }, []);

  return {
    docs,
    selectedDocs,
    handleAddDoc,
    handleDeleteDoc,
    handleUpdateDoc,
    toggleDocSelection
  };
};

export default useDocState; 