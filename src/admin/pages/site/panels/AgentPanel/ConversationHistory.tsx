/**
 * ConversationSwitcher — the panel-header title: the active chat's name with
 * a chevron that opens the conversation list (restore, delete, start new).
 *
 * Built on the shared `ContextMenu` primitive so positioning, dismiss
 * handling, and styling match the rest of the admin.
 */

import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from '@admin/ai/useAgentStore'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import styles from './ConversationHistory.module.css'

export function ConversationSwitcher() {
  const conversations = useAgentStore((s) => s.agentConversations)
  const activeId = useAgentStore((s) => s.agentConversationId)
  const loadAgentConversations = useAgentStore((s) => s.loadAgentConversations)
  const loadAgentConversation = useAgentStore((s) => s.loadAgentConversation)
  const startNewAgentConversation = useAgentStore((s) => s.startNewAgentConversation)
  const deleteAgentConversation = useAgentStore((s) => s.deleteAgentConversation)
  const isStreaming = useAgentStore((s) => s.isAgentStreaming)
  const conversationPending = useAgentStore((s) => s.isAgentConversationPending)
  const providerPending = useAgentStore((s) => s.isAgentProviderPending)
  const controlsDisabled = isStreaming || conversationPending || providerPending

  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  // Refresh the list every time the menu opens. Cheap query.
  useEffect(() => {
    if (!open) return
    void loadAgentConversations()
  }, [open, loadAgentConversations])

  // The list is only fetched when the menu opens, so a restored conversation
  // reads "New chat" until the first open. Acceptable: no extra fetch on mount.
  const label = conversations.find((conv) => conv.id === activeId)?.title ?? 'New chat'

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="xs"
        disabled={controlsDisabled}
        onClick={() => setOpen((v) => !v)}
        tooltip="Chat history"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation history"
        className={styles.switcherTrigger}
      >
        <span className={styles.switcherLabel}>{label}</span>
        <ChevronDownIcon size={10} className={styles.switcherChevron} aria-hidden="true" />
      </Button>
      {open && (
        <ContextMenu
          anchorRef={triggerRef}
          triggerRef={triggerRef}
          align="start"
          side="auto"
          offset={6}
          minWidth={260}
          maxHeight={360}
          ariaLabel="Conversation history"
          onClose={() => setOpen(false)}
        >
          <ContextMenuItem
            disabled={controlsDisabled}
            onClick={() => {
              startNewAgentConversation()
              setOpen(false)
            }}
          >
            <PlusIcon size={12} aria-hidden="true" />
            <span>New chat</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          {conversations.length === 0 ? (
            <ContextMenuItem disabled>
              <span>No chats yet.</span>
            </ContextMenuItem>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeId
              return (
                <ContextMenuItem
                  key={conv.id}
                  role="menuitemradio"
                  aria-checked={isActive}
                  active={isActive}
                  disabled={controlsDisabled}
                  className={styles.historyItem}
                  onClick={() => {
                    if (!isActive) void loadAgentConversation(conv.id)
                    setOpen(false)
                  }}
                >
                  <span className={styles.historyItemTitle}>{conv.title}</span>
                  {/* Span (not a native button) so it doesn't nest inside the
                      ContextMenuItem's Button — nested interactive
                      elements are invalid HTML + would trip BTN-3. */}
                  <span
                    role="button"
                    tabIndex={controlsDisabled ? -1 : 0}
                    aria-disabled={controlsDisabled}
                    className={styles.historyItemDelete}
                    aria-label={`Delete chat "${conv.title}"`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (controlsDisabled) return
                      void deleteAgentConversation(conv.id)
                    }}
                    onKeyDown={(e) => {
                      if (controlsDisabled) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        void deleteAgentConversation(conv.id)
                      }
                    }}
                  >
                    <TrashSolidIcon size={12} aria-hidden="true" />
                  </span>
                </ContextMenuItem>
              )
            })
          )}
        </ContextMenu>
      )}
    </>
  )
}
