import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as fs from "fs";
import * as path from "path";

// Import XML utilities
import { parseXmlString, applyFileChanges, prepareXmlWithCdata } from "./src/main/xmlUtils";
import { xmlFormatInstructions } from './src/main/xmlFormatInstructions';

// Import excluded files list
import { excludedFiles } from './excluded-files';

// Dynamic import for the 'ignore' module
let ignore: any;
try {
  // Using require for modules that don't have TypeScript definitions or are problematic with ESM
  ignore = require("ignore");
  console.log("Successfully loaded ignore module");
} catch (err) {
  console.error("Failed to load ignore module:", err);
  // Simple fallback implementation for when the ignore module fails to load
  ignore = {
    // Simple implementation that just matches exact paths
    createFilter: () => {
      return (path: string) => !excludedFiles.includes(path);
    }
  };
}

// Dynamic imports for tokenizers
let tiktoken: any;
let encoder: any;
try {
  tiktoken = require("tiktoken");
  console.log("Successfully loaded tiktoken module");
} catch (err) {
  console.error("Failed to load tiktoken module:", err);
  try {
    encoder = require("gpt-3-encoder");
    console.log("Successfully loaded gpt-3-encoder module");
  } catch (innerErr) {
    console.error("Failed to load gpt-3-encoder module:", innerErr);
    // Fallback implementation
    encoder = {
      encode: (text: string) => {
        // Very rough approximation of tokens (4 chars ~= 1 token)
        return new Array(Math.ceil(text.length / 4));
      }
    };
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // In production, load the bundled app
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  } else {
    // In development, load from the dev server
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Rest of the code would be converted...
// This is a starting point - the full file would need all functions converted to TypeScript 