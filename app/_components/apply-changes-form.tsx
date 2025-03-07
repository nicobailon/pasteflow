"use client";
import { applyChangesAction } from "../../actions/apply-changes-actions";
import React, { useEffect, useState } from "react";

export function ApplyChangesForm() {
  const [xml, setXml] = useState<string>("");
  const [projectDirectory, setProjectDirectory] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (successMessage) {
      timer = setTimeout(() => {
        setSuccessMessage("");
      }, 5000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [successMessage]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (errorMessage) {
      timer = setTimeout(() => {
        setErrorMessage("");
      }, 8000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [errorMessage]);

  const handleApply = async () => {
    setErrorMessage("");
    setSuccessMessage("");
    
    if (!xml.trim()) {
      setErrorMessage("Please paste XML before applying changes.");
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const result = await applyChangesAction(xml, projectDirectory.trim());
      if (result?.success) {
        setXml("");
        setSuccessMessage(result.message || "Changes applied successfully");
      }
    } catch (error: any) {
      setErrorMessage(
        error.message || "An error occurred while applying changes. Please check the XML format and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl w-full mx-auto p-4 flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-center mb-4">O1 XML Parser</h1>
      
      {errorMessage && (
        <div className="bg-destructive/20 border border-destructive text-destructive-foreground p-3 rounded-md">
          <strong>Error:</strong> {errorMessage}
        </div>
      )}
      
      {successMessage && (
        <div className="bg-green-500/20 border border-green-500 text-green-500 p-3 rounded-md">
          <strong>Success:</strong> {successMessage}
        </div>
      )}
      
      <div className="flex flex-col">
        <label className="mb-2 font-bold">Project Directory:</label>
        <input
          className="border bg-secondary text-secondary-foreground p-2 w-full rounded-md"
          type="text"
          value={projectDirectory}
          onChange={(e) => setProjectDirectory(e.target.value)}
          placeholder="e.g. /Users/myusername/projects/o1-xml-parser"
          disabled={isSubmitting}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Leave empty to use the default from environment variables
        </p>
      </div>
      
      <div className="flex flex-col">
        <label className="mb-2 font-bold">Paste XML here:</label>
        <textarea
          className="border bg-secondary text-secondary-foreground p-2 h-64 w-full rounded-md font-mono text-sm"
          value={xml}
          onChange={(e) => setXml(e.target.value)}
          placeholder="Paste the XML from the o1 model response here. The XML should be in the format:
<code_changes>
  <changed_files>
    <file>
      <file_operation>CREATE</file_operation>
      <file_path>app/page.tsx</file_path>
      <file_code><![CDATA[
// Your code here
]]></file_code>
    </file>
  </changed_files>
</code_changes>"
          disabled={isSubmitting}
        />
      </div>
      
      <button
        className={`bg-primary text-primary-foreground p-2 rounded-md hover:bg-primary/90 transition-colors ${
          isSubmitting ? "opacity-50 cursor-not-allowed" : ""
        }`}
        onClick={handleApply}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Applying Changes..." : "Apply Changes"}
      </button>
    </div>
  );
} 