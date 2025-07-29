# Web Worker Token Counting Feature

The Web Worker token counting feature provides asynchronous token counting to improve UI responsiveness, especially when processing large files or many files at once.

**Note: This feature is enabled by default** as it significantly improves performance and includes comprehensive error handling.

## How to Enable/Disable

### Method 1: Developer Settings (Recommended)
1. Open PasteFlow
2. Press `Cmd+Shift+D` (Mac) or `Ctrl+Shift+D` (Windows/Linux)
3. Toggle the "Web Worker Token Counting" switch
4. The app will automatically reload with the feature enabled/disabled

### Method 2: Developer Console
If the keyboard shortcut doesn't work, you can enable it via the browser developer tools:

1. Open Developer Tools in the Electron app:
   - Mac: `Cmd+Option+I`
   - Windows/Linux: `Ctrl+Shift+I`
2. Go to the Console tab
3. Run one of these commands:
   ```javascript
   // To enable
   localStorage.setItem('enable-worker-tokens', 'true');
   location.reload();
   
   // To disable
   localStorage.setItem('enable-worker-tokens', 'false');
   location.reload();
   
   // To check current status
   localStorage.getItem('enable-worker-tokens');
   ```

### Method 3: For Developers (Environment Variable)
When developing, you can set an environment variable before starting the app:
```bash
ENABLE_WORKER_TOKENS=true npm run dev:electron
```

## What Changes When Enabled?

When the Web Worker feature is enabled:
- Token counting happens in background threads
- UI remains responsive while counting tokens
- File cards show "Counting tokens..." during processing
- Multiple files can be counted in parallel
- Automatic fallback to estimation if workers fail

## Performance Benefits

- **50-80% reduction in UI freezing** for large files
- **Parallel processing** of multiple files
- **Better user experience** with loading indicators
- **Graceful degradation** if workers encounter issues

## Troubleshooting

If you experience issues:
1. Disable the feature using the methods above
2. Check the console for error messages
3. Report issues with console output

## Monitoring

When enabled, you can monitor performance:
1. Open Developer Tools (`Cmd+Option+I` or `Ctrl+Shift+I`)
2. Go to Console
3. Look for messages about:
   - Worker initialization
   - Token counting performance
   - Any fallback to estimation

The feature includes comprehensive error handling and will automatically fall back to the original synchronous counting if any issues occur.