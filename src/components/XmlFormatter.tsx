import React, { useState } from 'react';

interface XmlFormatterProps {
  onFormat: (formattedXml: string) => void;
}

const XmlFormatter = ({ onFormat }: XmlFormatterProps): JSX.Element => {
  const [xml, setXml] = useState('');
  const [error, setError] = useState(null as string | null);
  const [isProcessing, setIsProcessing] = useState(false);

  const formatXml = (): void => {
    if (!xml.trim()) {
      setError('Please enter XML content');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // First try to format locally
      if (!xml.includes('<changed_files>') || !xml.includes('</changed_files>')) {
        setError('XML must contain <changed_files> tags');
        setIsProcessing(false);
        return;
      }

      // Use the main process for more robust formatting
      window.electron.ipcRenderer.invoke('format-xml', { xml })
        .then((result: { success: boolean, xml?: string, error?: string }) => {
          setIsProcessing(false);
          if (result.success && result.xml) {
            setXml(result.xml);
            onFormat(result.xml);
          } else {
            setError(result.error || 'Error formatting XML');
          }
        })
        .catch((err: Error) => {
          setIsProcessing(false);
          setError(`Error: ${err.message}`);
        });
    } catch (err) {
      setIsProcessing(false);
      setError(`Error formatting XML: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">XML Formatter</h3>
      <p className="text-sm text-gray-600">
        Paste your XML here to automatically format it with CDATA sections for React code.
      </p>
      <textarea
        className="w-full h-48 p-2 border border-gray-300 rounded-md"
        value={xml}
        onChange={(e) => setXml(e.target.value)}
        placeholder="<changed_files>...</changed_files>"
        disabled={isProcessing}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={formatXml}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          disabled={isProcessing}
        >
          {isProcessing ? "Processing..." : "Format XML"}
        </button>
      </div>
    </div>
  );
};

export default XmlFormatter; 