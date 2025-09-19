// packages/frontend/src/app/features/bot-configs/ui/BotConfigsTable.tsx

"use client";

import { useEffect, useState } from 'react';
import { useBotConfigs } from '@/app/features/bot-configs/model/useBotConfigs';
import { Button } from '@/app/shared/ui/Button';
import { LoadingSpinner } from '@/app/shared/ui/LoadingSpinner';
import { Toast } from '@/app/shared/ui/Toast';
import { BotConfigFormModal } from './BotConfigFormModal';
import { WebhookCopyTooltip } from './WebhookCopyTooltip';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Info, Edit, Trash2, Plus } from 'lucide-react';
import { IconButton } from '@/app/shared/ui/IconButton';
import type { BotConfig } from '@/app/entities/bot-config/types';

export function BotConfigsTable() {
  const {
    items: botConfigs = [],
    isLoading,
    error,
    refetch,
    toggleIsEnabled,
    isToggling,
    toggleError,
    deleteBotConfig,
    isDeleting,
    deleteError,
    resetDelete,
  } = useBotConfigs();

  const [modalOpen, setModalOpen] = useState(false);
  const [editData, setEditData] = useState<BotConfig | null>(null);
  const [deleteConfig, setDeleteConfig] = useState<BotConfig | null>(null);

  useEffect(() => {
    if (deleteError && !isDeleting) {
      Toast({ message: 'Error al eliminar bot.', type: 'error' });
    }
  }, [deleteError, isDeleting]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <Toast message="Error al cargar bots." type="error" />
        <Button variant="secondary" onClick={() => refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-2">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Configuraciones de Bots</h1>
        <Button
          variant="primary"
          onClick={() => {
            setEditData(null);
            setModalOpen(true);
          }}
        >
          <Plus size={18} className="mr-2" />
          Crear Bot
        </Button>
      </div>
      <div className="bg-white rounded-2xl shadow min-h-[calc(100vh-300px)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-800">
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Kommo</th>
              <th className="px-4 py-3 text-left">País</th>
              <th className="px-4 py-3 text-left">Zona horaria</th>
              <th className="px-4 py-3 text-center">¿Está listo?</th>
              <th className="px-4 py-3 text-left">Webhook</th>
              <th className="px-4 py-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {botConfigs
              .filter((c): c is BotConfig => !!c)
              .map((config) => (
                <tr
                  key={config.botConfigId}
                  className="border-b last:border-none hover:bg-gray-50 transition"
                >
                  <td className="px-4 py-3">
                    {config.botConfigType === 'notificationBot' ? 'Notification' : 'Chat'}
                  </td>
                  <td className="px-4 py-3">{`${config.kommoSubdomain}.kommo.com`}</td>
                  <td className="px-4 py-3">{config.defaultCountry}</td>
                  <td className="px-4 py-3">{config.timezone}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center gap-1 justify-center">
                      {config.isReady ? (
                        <span className="text-green-600 font-semibold">Sí</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                      <Tooltip.Root delayDuration={100}>
                        <Tooltip.Trigger asChild>
                          <button
                            tabIndex={-1}
                            type="button"
                            className="ml-2 text-gray-400 hover:text-blue-500 p-1"
                            aria-label="Ver detalles de custom fields"
                          >
                            <Info size={18} />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content
                            side="right"
                            align="center"
                            className="z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[230px] max-w-[360px] max-h-72 overflow-y-auto text-left"
                          >
                            {config.kommoLeadsCustomFields?.length ? (
                              <div>
                                <div className="mb-2 font-bold text-sm text-gray-600">
                                  Campos requeridos:
                                </div>
                                {config.kommoLeadsCustomFields.map((field: any, idx: number) => (
                                  <div
                                    key={field.field_name + idx}
                                    className={`flex flex-col mb-2 rounded px-2 py-1 ${
                                      field.exists && field.field_type === 'textarea'
                                        ? 'bg-green-50 text-green-800'
                                        : 'bg-red-50 text-red-800'
                                    }`}
                                  >
                                    <span className="font-semibold">{field.field_name}</span>
                                    <span>
                                      {field.exists && field.field_type === 'textarea' && (
                                        <>✔️ Campo creado y de tipo texto largo</>
                                      )}
                                      {!field.exists && (
                                        <>❌ Debe crearse el custom field tipo <strong>texto largo</strong></>
                                      )}
                                      {field.exists && field.field_type !== 'textarea' && (
                                        <>❌ El tipo debe ser texto largo (actual: {field.field_type || '—'})</>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-400">
                                No hay campos requeridos para este perfil.
                              </div>
                            )}
                            <Tooltip.Arrow className="fill-white" />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    </div>
                  </td>
                  <td className="px-4 py-3">{config.botConfigType === 'chatBot' ? (
                      <WebhookCopyTooltip config={config} />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-2 justify-center">
                      <IconButton
                        icon={Edit}
                        label="Editar configuración"
                        onClick={() => {
                          setEditData(config);
                          setModalOpen(true);
                        }}
                      />
                      <IconButton
                        icon={Trash2}
                        label="Eliminar configuración"
                        onClick={() => {
                          setDeleteConfig(config);
                          resetDelete();
                        }}
                        loading={isDeleting && deleteConfig?.botConfigId === config.botConfigId}
                        disabled={isDeleting && deleteConfig?.botConfigId === config.botConfigId}
                      />
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {modalOpen && (
        <BotConfigFormModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          initialData={editData}
        />
      )}
      {deleteConfig && (
        <ConfirmDeleteDialog
          open={!!deleteConfig}
          botName={deleteConfig.botConfigType + ' de ' + deleteConfig.kommoSubdomain}
          isLoading={isDeleting}
          error={!!deleteError}
          onCancel={() => {
            setDeleteConfig(null);
            resetDelete();
          }}
          onConfirm={() => {
            deleteBotConfig(
              {
                botConfigType: deleteConfig.botConfigType,
                botConfigId: deleteConfig.botConfigId,
                clinicSource: deleteConfig.clinicSource,
                clinicId: deleteConfig.clinicId,
              },
              {
                onSuccess: () => {
                  setDeleteConfig(null);
                },
              }
            );
          }}
        />
      )}
      {toggleError && <Toast message="Error al actualizar habilitado." type="error" />}
    </div>
  );
}
