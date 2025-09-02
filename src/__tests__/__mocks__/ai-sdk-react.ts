import { useCallback, useState } from "react";

type Message = { role: string; content: string | unknown; metadata?: unknown };

export const useChat = (_opts?: any) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<'ready'|'submitted'|'streaming'|'error'>('ready');

  const append = useCallback((m: Message) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const sendMessage = useCallback((msg?: { text?: string }) => {
    if (!input.trim()) return;
    setStatus('submitted');
    const text = msg?.text ?? input;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    // Simulate assistant echo for tests
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: text }]);
      setStatus('ready');
      setInput("");
    }, 0);
  }, [input]);

  const stop = useCallback(() => setStatus('ready'), []);

  return { messages, input, setInput, sendMessage, status, stop, append };
};
