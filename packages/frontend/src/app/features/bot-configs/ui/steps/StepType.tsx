import { Button } from "@/app/shared/ui/Button";
import type { BotConfigType } from "@/app/entities/bot-config/types";

interface StepTypeProps {
  value?: BotConfigType;
  onChange: (type: BotConfigType) => void;
}

export function StepType({ value, onChange }: StepTypeProps) {
  const handleSelect = (type: BotConfigType) => {
    onChange(type);
  };

  return (
    <div className="flex flex-col items-center gap-8 p-6">
      <h2 className="text-lg font-semibold">Selecciona el tipo de Bot a configurar</h2>
      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-md">
        <Button
          type="button"
          variant={value === "notificationBot" ? "primary" : "secondary"}
          className="w-full"
          onClick={() => handleSelect("notificationBot")}
          aria-pressed={value === "notificationBot"}
        >
          Notification Bot
        </Button>
        <Button
          type="button"
          variant={value === "chatBot" ? "primary" : "secondary"}
          className="w-full"
          onClick={() => handleSelect("chatBot")}
          aria-pressed={value === "chatBot"}
        >
          Chat Bot
        </Button>
      </div>
      <div className="text-sm text-muted-foreground pt-6">
        <ul className="list-disc pl-5 text-left">
          <li><b>Notification Bot:</b> Envía notificaciones automáticas integradas con Kommo.</li>
          <li><b>Chat Bot:</b> Automatiza conversaciones, integra OpenAI y permite placeholders personalizables.</li>
        </ul>
      </div>
    </div>
  );
}
