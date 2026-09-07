/**
 * AgentPanel — AI assistant content for a docked or floating panel host.
 *
 * Visibility is controlled by `isAgentOpen` in the agentSlice; the panel
 * stays mounted (display:none when closed) so conversation state survives
 * open/close cycles. The host (`LeftSidebar`'s panel host in the Site editor,
 * `ContentAgentMount` in Content) owns positioning, sizing, and all floating
 * chrome; this component fills whatever it is given.
 *
 * Runtime model:
 * - Agent calls stream through `/admin/api/ai/chat/site`.
 * - The Bun server selects the configured provider credential and model.
 * - Drivers call provider REST/SSE endpoints directly; no provider SDK runs.
 *
 * Accessibility (WCAG 2.1 AA):
 * - role="complementary" + aria-label="AI Assistant" on the panel landmark
 * - header title is the ConversationSwitcher (aria-label "Conversation
 *   history"; rows are role="menuitemradio", delete is `Delete chat "…"`)
 * - role="log" + aria-live="polite" + aria-busy + aria-label="Conversation"
 *   on the message thread
 * - role="status" for tool call rows and the "Thinking…" row (screenshot rows
 *   are a native <details>/<summary> disclosure carrying the same label)
 * - role="alert" for stream errors, tool errors, and the credential notice
 * - keyboard: Escape closes the panel
 */

import { useEffect, useState } from 'react'
import { useAgentStore, useAgentStoreApi } from '@admin/ai/useAgentStore'
import { useAsyncResource } from '@admin/lib/useAsyncResource'
import { listCredentials } from '@admin/ai/api'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { PanelHeader, PanelModeButton } from '@admin/shared/PanelHeader'
import type { DockablePanelProps } from '@admin/shared/Panel'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import { ConversationSwitcher } from './ConversationHistory'
import { AgentComposer, type ComposerLockReason } from './AgentComposer'
import { AgentSettingsButton } from './AgentEmptyState'
import { AgentThread } from './AgentThread'
import { AgentImageContextMenu } from './AgentImageContextMenu'
import { AgentImagePreview } from './AgentImagePreview'
import type { AgentImageMenuRequest, AgentPreviewImage } from './agentImageTypes'
import styles from './AgentPanel.module.css'

export function AgentPanel({ mode = 'docked', dragHandleProps, onToggleMode }: DockablePanelProps) {
  const agentStore = useAgentStoreApi()
  const isOpen = useAgentStore((s) => s.isAgentOpen)
  const isStreaming = useAgentStore((s) => s.isAgentStreaming)
  const conversationPending = useAgentStore((s) => s.isAgentConversationPending)
  const providerPending = useAgentStore((s) => s.isAgentProviderPending)
  const messages = useAgentStore((s) => s.agentMessages)
  const agentError = useAgentStore((s) => s.agentError)
  const closeAgent = useAgentStore((s) => s.closeAgent)
  const startNewAgentConversation = useAgentStore((s) => s.startNewAgentConversation)
  const loadScopeDefault = useAgentStore((s) => s.loadScopeDefault)
  const composerEpoch = useAgentStore((s) => s.agentComposerEpoch)
  const activeCredentialId = useAgentStore((s) => s.agentActiveCredentialId)
  const activeModelId = useAgentStore((s) => s.agentActiveModelId)
  const [previewImage, setPreviewImage] = useState<AgentPreviewImage | null>(null)
  const [imageMenu, setImageMenu] = useState<AgentImageMenuRequest | null>(null)
  const credentialsResource = useAsyncResource(
    (signal) => listCredentials(signal),
    [],
    { swallowErrors: true },
  )
  const credentials = credentialsResource.data ?? []
  const credentialsLoaded = credentialsResource.data !== null || !credentialsResource.loading
  const noCredentials = credentialsLoaded && credentials.length === 0
  // The no-provider error renders as the setup empty state, never as an error line.
  const noProviderError = agentError?.startsWith('No AI provider configured') ?? false
  // The composer can't run a turn without an active (credential, model) — one
  // is either preloaded from the scope default or picked in the model picker.
  // Locking off `hasActiveProvider` (not a sticky error string) is what keeps
  // the composer usable the instant the user picks a model.
  const hasActiveProvider = Boolean(activeCredentialId && activeModelId)
  const composerLocked = !hasActiveProvider
  // Why the composer is locked, used for the empty-state + placeholder copy:
  //   'setup'       → no credentials exist at all → add one in AI settings.
  //   'chooseModel' → credentials exist but no scope default / pick yet →
  //                   choose a model below, or set a default in AI settings.
  // While credentials are still loading we keep messaging neutral (null) so
  // the panel doesn't flash a setup prompt before the default preload lands.
  const lockReason: ComposerLockReason | null = !composerLocked
    ? null
    : noCredentials
      ? 'setup'
      : credentialsLoaded
        ? 'chooseModel'
        : null

  // Preload the per-scope default credential + model when the panel opens, so
  // the picker shows the configured default immediately and the first send
  // uses it. The action no-ops if a conversation or explicit pick already
  // exists, so re-opens are cheap.
  useEffect(() => {
    if (isOpen) void loadScopeDefault()
  }, [isOpen, loadScopeDefault])

  useEffect(() => agentStore.subscribe((state, previous) => {
    if (
      (previous.isAgentOpen && !state.isAgentOpen)
      || previous.agentComposerEpoch !== state.agentComposerEpoch
    ) {
      setPreviewImage(null)
      setImageMenu(null)
    }
  }), [agentStore])

  function openImageMenu(request: AgentImageMenuRequest): void {
    setImageMenu(request)
  }

  function openImagePreview(image: AgentPreviewImage): void {
    setImageMenu(null)
    setPreviewImage(image)
  }

  function closeImageMenu(): void {
    const returnFocus = imageMenu?.returnFocus
    setImageMenu(null)
    if (returnFocus?.isConnected) {
      requestAnimationFrame(() => returnFocus.focus())
    }
  }

  function closeImagePreview(): void {
    setPreviewImage(null)
    setImageMenu(null)
  }

  // Escape closes the panel — unless an image menu owns the key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || imageMenu !== null) return
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault()
        closeAgent()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, imageMenu, closeAgent])

  return (
    <aside
      role="complementary"
      aria-label="AI Assistant"
      data-panel=""
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      className={cn(styles.root, !isOpen && styles.rootClosed)}
    >
      <div
        data-testid="agent-panel"
        // A --bg-surface card inside the chrome sidebar: its fields need the
        // card ramp back.
        data-surface="card"
        className={styles.panel}
      >
        <PanelHeader
          panelId="agent"
          title="AI Assistant"
          titleContent={<ConversationSwitcher />}
          onClose={closeAgent}
          dragHandleProps={dragHandleProps}
        >
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            disabled={isStreaming || conversationPending || providerPending}
            onClick={startNewAgentConversation}
            tooltip="New chat"
            aria-label="New chat"
            data-testid="agent-new-chat-header-button"
          >
            <PlusIcon size={12} aria-hidden="true" />
          </Button>
          <AgentSettingsButton
            variant="header"
            label="AI settings"
            data-testid="agent-settings-header-button"
          />
          {onToggleMode && (
            <PanelModeButton
              mode={mode}
              panelLabel="AI Assistant"
              dockLocation="left sidebar"
              onToggle={onToggleMode}
            />
          )}
        </PanelHeader>

        <AgentThread
          messages={messages}
          isStreaming={isStreaming}
          lockReason={lockReason}
          error={agentError && !noProviderError ? agentError : null}
          onOpenImage={openImagePreview}
          onOpenImageMenu={openImageMenu}
        />

        <AgentComposer
          key={composerEpoch}
          composerLocked={composerLocked}
          lockReason={lockReason}
          credentials={credentials}
          credentialsLoaded={credentialsLoaded}
          onRefreshCredentials={credentialsResource.refresh}
          onOpenImage={openImagePreview}
          onOpenImageMenu={openImageMenu}
        />
      </div>
      <AgentImagePreview
        image={isOpen ? previewImage : null}
        imageMenuOpen={imageMenu !== null}
        onOpenImageMenu={openImageMenu}
        onClose={closeImagePreview}
      />
      {isOpen && imageMenu && (
        <AgentImageContextMenu request={imageMenu} onClose={closeImageMenu} />
      )}
    </aside>
  )
}
