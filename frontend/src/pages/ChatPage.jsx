import { useState } from "react";
import Chat from "../components/Chat";
import RoutingPanel from "../components/RoutingPanel";

export default function ChatPage(props) {
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  return (
    <section className={`chat-layout ${panelCollapsed ? "chat-layout--collapsed" : ""}`}>
      <div className="chat-layout__main">
        <Chat {...props} />
      </div>
      <div className="chat-layout__side">
        <RoutingPanel
          insight={props.selectedInsight}
          collapsed={panelCollapsed}
          onToggle={() => setPanelCollapsed((value) => !value)}
        />
      </div>
    </section>
  );
}
