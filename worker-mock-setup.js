// Minimal Worker mock for Jest testing - plain JavaScript

// Check if Jest fake timers are active
function areFakeTimersActive() {
  if (typeof jest !== 'undefined' && jest._isMockFunction && jest._isMockFunction(setTimeout)) {
    return true;
  }
  // Check if setTimeout looks mocked
  if (typeof setTimeout.clock !== 'undefined' || setTimeout._isMockFunction) {
    return true;
  }
  return false;
}

// Define minimal Worker mock class
class MockWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.onmessage = null;
    this.onmessageerror = null;
    this.onerror = null;
    
    // Send WORKER_READY after construction
    // If fake timers are active, send synchronously
    if (areFakeTimersActive()) {
      // Delay to next tick to avoid infinite loops
      Promise.resolve().then(() => {
        this.dispatchEvent(new MessageEvent('message', { 
          data: { type: 'WORKER_READY' } 
        }));
      });
    } else if (typeof setImmediate !== 'undefined') {
      setImmediate(() => {
        this.dispatchEvent(new MessageEvent('message', { 
          data: { type: 'WORKER_READY' } 
        }));
      });
    } else {
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', { 
          data: { type: 'WORKER_READY' } 
        }));
      }, 0);
    }
  }

  postMessage(message) {
    const msg = message;
    
    // Use appropriate async mechanism based on timer state
    const respond = (callback) => {
      if (areFakeTimersActive()) {
        // Use Promise to avoid fake timer issues
        Promise.resolve().then(callback);
      } else if (typeof setImmediate !== 'undefined') {
        setImmediate(callback);
      } else {
        setTimeout(callback, 0);
      }
    };
    
    respond(() => {
      switch (msg.type) {
        case 'INIT':
          this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'INIT_COMPLETE', id: msg.id, success: true }
          }));
          break;
          
        case 'COUNT_TOKENS':
          const text = msg.payload?.text || '';
          const tokenCount = Math.ceil(text.length / 4);
          this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'TOKEN_COUNT', id: msg.id, result: tokenCount, fallback: false }
          }));
          break;
          
        case 'BATCH_COUNT':
          const texts = msg.payload?.texts || [];
          const results = texts.map(t => Math.ceil(t.length / 4));
          this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'BATCH_RESULT', id: msg.id, results }
          }));
          break;
          
        case 'HEALTH_CHECK':
          this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'HEALTH_RESPONSE', id: msg.id, healthy: true }
          }));
          break;
      }
    });
  }

  terminate() {
    this.listeners.clear();
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
    }
  }

  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type) || [];
    for (const listener of listeners) {
      listener(event);
    }
    
    if (event.type === 'message' && this.onmessage) {
      this.onmessage.call(this, event);
    } else if (event.type === 'error' && this.onerror) {
      this.onerror(event);
    }
    
    return true;
  }
}

// Set global Worker
global.Worker = MockWorker;

// Mock navigator.hardwareConcurrency for consistent test behavior
if (typeof global.navigator === 'undefined') {
  global.navigator = {};
}
if (!global.navigator.hardwareConcurrency) {
  global.navigator.hardwareConcurrency = 4;
}

// Add TextEncoder/TextDecoder if not available
if (typeof TextEncoder === 'undefined') {
  class MockTextEncoder {
    encode(input = '') {
      const bytes = [];
      for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        if (char < 0x80) {
          bytes.push(char);
        } else if (char < 0x800) {
          bytes.push(0xC0 | (char >> 6), 0x80 | (char & 0x3F));
        } else {
          bytes.push(0xE0 | (char >> 12), 0x80 | ((char >> 6) & 0x3F), 0x80 | (char & 0x3F));
        }
      }
      return new Uint8Array(bytes);
    }
  }
  global.TextEncoder = MockTextEncoder;
}

if (typeof TextDecoder === 'undefined') {
  class MockTextDecoder {
    decode(bytes) {
      if (!bytes) return '';
      let result = '';
      let i = 0;
      while (i < bytes.length) {
        const byte = bytes[i];
        if (byte < 0x80) {
          result += String.fromCharCode(byte);
          i++;
        } else if ((byte & 0xE0) === 0xC0) {
          result += String.fromCharCode(((byte & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
          i += 2;
        } else {
          result += String.fromCharCode(((byte & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
          i += 3;
        }
      }
      return result;
    }
  }
  global.TextDecoder = MockTextDecoder;
}