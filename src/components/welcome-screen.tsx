import React from 'react';
import { FolderOpen } from 'lucide-react';

interface WelcomeScreenProps {
  openFolder: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ openFolder }) => {
  return (
    <div className="welcome-screen">
      <pre className="ascii-logo">
{`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ██████╗  █████╗ ███████╗████████╗███████╗███████╗██╗      ██████╗ ██╗    ██╗ ║
║  ██╔══██╗██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔════╝██║     ██╔═══██╗██║    ██║ ║
║  ██████╔╝███████║███████╗   ██║   █████╗  █████╗  ██║     ██║   ██║██║ █╗ ██║ ║
║  ██╔═══╝ ██╔══██║╚════██║   ██║   ██╔══╝  ██╔══╝  ██║     ██║   ██║██║███╗██║ ║
║  ██║     ██║  ██║███████║   ██║   ███████╗██║     ███████╗╚██████╔╝╚███╔███╔╝ ║
║  ╚═╝     ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝  ║
║                                                                              ║
║                           © 2025 PasteFlow Corp v1.0                         ║
║                                                                              ║
║                        Select a folder to get started                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`}
      </pre>
      <div className="welcome-message">
        <button className="welcome-button" onClick={openFolder}>
          <FolderOpen size={36} />
        </button>
      </div>
    </div>
  );
};

export default WelcomeScreen;