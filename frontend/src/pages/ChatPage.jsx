import Chat from "../components/Chat";

export default function ChatPage(props) {
  return (
    <section className="chat-page">
      <div className="chat-page__container">
        <Chat {...props} />
      </div>
    </section>
  );
}
