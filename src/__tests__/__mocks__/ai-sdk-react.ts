import { useCallback, useState, useRef } from "react";

type Message = { role: string; content: string | unknown; metadata?: unknown };

let lastHeaders: Record<string, string | undefined> | undefined;
let lastBody: any;
let lastOptions: any;
let errorInjector: null | ((code?: number) => void) = null;

export const __aiSdkMock = {
  getLastRequest: () => ({ headers: lastHeaders, body: lastBody, options: lastOptions }),
  simulateError: (code = 500) => {
    if (typeof (errorInjector as any) === 'function') (errorInjector as any)(code);
  }
};

export const useChat = (opts?: any) => {
  lastOptions = opts || {};
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<'ready'|'submitted'|'streaming'|'error'>('ready');
  const optionsRef = useRef(opts || {});

  const append = useCallback((m: Message) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const stop = useCallback(() => setStatus('ready'), []);

  errorInjector = (code?: number) => {
    setStatus('error');
    if (optionsRef.current?.onError) optionsRef.current.onError({ status: code });
  };

  const sendMessage = useCallback((msg?: { text?: string }) => {
    const text = (msg?.text ?? input ?? '').toString();
    if (!text.trim()) return;
    setStatus('submitted');
    // Build request body and capture headers
    let requestBody: any = { messages: messages.map((m) => ({ role: m.role, content: m.content })) };
    const headers = optionsRef.current?.headers;
    lastHeaders = headers;
    if (typeof optionsRef.current?.prepareSendMessagesRequest === 'function') {
      const prepared = optionsRef.current.prepareSendMessagesRequest({ id: 'test', messages: requestBody.messages, requestBody });
      lastBody = prepared;
    } else {
      lastBody = requestBody;
    }
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    // Simulate assistant echo for tests
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: text }]);
      setStatus('ready');
      setInput("");
      if (optionsRef.current?.onFinish) optionsRef.current.onFinish();
    }, 0);
  }, [input, messages]);

  return { messages, input, setInput, sendMessage, status, stop, append };
};
