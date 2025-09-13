// packages/core/src/application/usecases/RegularConversationUseCase.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";

interface RegularConversationInput {
  params: {
    assistantMessage: string; // texto del assistant ya listo
  };
}

interface RegularConversationOutput {
  success: boolean;
  toolOutput: string;
}

/**
 * Use Case para mensajes de conversación normal donde
 * no se invoca ninguna tool‑call adicional.
 * Solo devuelve el mensaje del assistant como `toolOutput`
 * para que el orquestador lo envíe a `resolveRun` y luego a Kommo.
 */
export class RegularConversationUseCase {
  constructor() {}

  public async execute(input: RegularConversationInput): Promise<RegularConversationOutput> {
    const { params } = input;
    Logger.info('[RegularConversationUseCase] Inicio de ejecución', { assistantMessage: params.assistantMessage });

    try {
      Logger.debug('[RegularConversationUseCase] Preparando respuesta');
      const toolOutput = params.assistantMessage;
      Logger.info('[RegularConversationUseCase] Ejecución completada con éxito', { toolOutput });
      return { success: true, toolOutput };
    } catch (error) {
      Logger.error('[RegularConversationUseCase] Error durante la ejecución', { error });
      return { success: false, toolOutput: '' };
    }
  }
}
