import Header from './components/Header.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import { useChat } from './hooks/useChat.js';
import './assets/styles/App.css';

export default function App() {
  const { messages, isLoading, error, remaining, send, reset } = useChat();

  return (
    <div className="app">
      <Header onReset={messages.length > 0 ? reset : null} />
      <InstallPrompt />
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        error={error}
        remaining={remaining}
        onSend={send}
      />
    </div>
  );
}
