/**
 * AgentThread — the conversation log. Consecutive same-role messages fold
 * into one turn; inside an assistant turn, text, images, and runs of tool
 * calls render in the order the model emitted them.
 */
import { memo, useEffect, useRef } from 'react'
import { renderMarkdownToHtml, type AgentMessage, type AgentToolCall } from '@site/agent'
import { CircleAlertSolidIcon } from 'pixel-art-icons/icons/circle-alert-solid'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import { cn } from '@ui/cn'
import type { ComposerLockReason } from './AgentComposer'
import { AgentCredentialNotice, AgentEmptyState } from './AgentEmptyState'
import { AgentImageGallery } from './AgentImageGallery'
import type { AgentPreviewImage, OpenAgentImageMenu } from './agentImageTypes'
import { ActivityRow, ToolCallRow } from './ToolCallRow'
import styles from './AgentThread.module.css'

interface AgentThreadProps {
  messages: AgentMessage[]
  isStreaming: boolean
  lockReason: ComposerLockReason | null
  /** Already filtered by the panel — the no-provider error renders as the setup empty state instead. */
  error: string | null
  onOpenImage(image: AgentPreviewImage): void
  onOpenImageMenu: OpenAgentImageMenu
}

export function AgentThread({
  messages,
  isStreaming,
  lockReason,
  error,
  onOpenImage,
  onOpenImageMenu,
}: AgentThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const groups = groupConsecutiveMessages(messages)
  const lastGroup = groups.at(-1)
  // A pending tool row already animates; the trailing "Thinking…" row covers
  // the gaps where the model is thinking or streaming text.
  const anyPending = messages.some((message) =>
    message.blocks.some((block) => block.kind === 'toolCall' && block.toolCall.status === 'pending'),
  )
  const showWorking = isStreaming && !anyPending

  return (
    <div
      ref={threadRef}
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions text"
      aria-label="Conversation"
      aria-busy={isStreaming}
      className={styles.thread}
    >
      {messages.length === 0 ? (
        <AgentEmptyState mode={lockReason ?? 'prompt'} />
      ) : (
        <>
          {lockReason && <AgentCredentialNotice mode={lockReason} />}
          {groups.map((group) => (
            <Turn
              key={group.id}
              group={group}
              working={showWorking && group === lastGroup && group.role === 'assistant'}
              onOpenImage={onOpenImage}
              onOpenImageMenu={onOpenImageMenu}
            />
          ))}
          {showWorking && lastGroup?.role === 'user' && <WorkingRow />}
        </>
      )}
      {error && (
        <p role="alert" className={cn(styles.noticeLine, styles.noticeLineDanger)}>
          <CircleAlertSolidIcon size={12} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

interface ConversationGroup {
  id: string
  role: AgentMessage['role']
  messages: AgentMessage[]
}

function Turn({
  group,
  working,
  onOpenImage,
  onOpenImageMenu,
}: {
  group: ConversationGroup
  working: boolean
  onOpenImage(image: AgentPreviewImage): void
  onOpenImageMenu: OpenAgentImageMenu
}) {
  const isUser = group.role === 'user'
  return (
    <div className={styles.turn} data-role={group.role}>
      <span className={styles.srOnly}>{isUser ? 'You' : 'Assistant'}</span>
      {groupRenderItems(group.messages).map((item) =>
        item.kind === 'text' ? (
          <MarkdownText
            key={item.key}
            text={item.text}
            className={isUser ? styles.userCard : undefined}
          />
        ) : item.kind === 'images' ? (
          <MessageImageGallery
            key={item.key}
            images={item.images}
            isUser={isUser}
            onOpenImage={onOpenImage}
            onOpenImageMenu={onOpenImageMenu}
          />
        ) : (
          <ToolRun
            key={item.key}
            toolCalls={item.toolCalls}
            onOpenImage={onOpenImage}
            onOpenImageMenu={onOpenImageMenu}
          />
        ),
      )}
      {working && <WorkingRow />}
    </div>
  )
}

function ToolRun({
  toolCalls,
  onOpenImage,
  onOpenImageMenu,
}: {
  toolCalls: AgentToolCall[]
  onOpenImage(image: AgentPreviewImage): void
  onOpenImageMenu: OpenAgentImageMenu
}) {
  const failed = toolCalls.filter((toolCall) => toolCall.status === 'error').length
  return (
    <div className={styles.activity}>
      {toolCalls.map((toolCall) => (
        <ToolCallRow
          key={toolCall.id}
          toolCall={toolCall}
          onOpenImage={onOpenImage}
          onOpenImageMenu={onOpenImageMenu}
        />
      ))}
      {/* A lone failed row already shows its own error; the tally is for multi-step runs. */}
      {failed > 0 && toolCalls.length > 1 && (
        <p className={styles.runMeta} data-tone="danger">{failed} failed</p>
      )}
    </div>
  )
}

function WorkingRow() {
  return (
    <div role="status">
      <ActivityRow icon={<LoaderIcon size={12} />} title="Thinking…" />
    </div>
  )
}

// Consecutive messages of the same role become one turn. The agent emits each
// tool call as its own message, so without this a burst of tool activity
// would render as a stack of separate assistant turns.
function groupConsecutiveMessages(messages: AgentMessage[]): ConversationGroup[] {
  const groups: ConversationGroup[] = []
  for (const message of messages) {
    const last = groups.at(-1)
    if (last && last.role === message.role) {
      last.messages.push(message)
      continue
    }
    groups.push({ id: message.id, role: message.role, messages: [message] })
  }
  return groups
}

// Flatten a turn's blocks in emission order, coalescing runs of images and
// runs of tool calls so each renders as one gallery / one activity run.
type MessageRenderItem =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'images'; key: string; images: Array<{ key: string; src: string }> }
  | { kind: 'tools'; key: string; toolCalls: AgentToolCall[] }

function groupRenderItems(messages: AgentMessage[]): MessageRenderItem[] {
  const items: MessageRenderItem[] = []
  for (const message of messages) {
    message.blocks.forEach((block, index) => {
      if (block.kind === 'text') {
        // Position-based key, stable as streaming deltas append in place.
        items.push({ kind: 'text', key: `text-${message.id}-${index}`, text: block.text })
        return
      }
      if (block.kind === 'image') {
        const image = { key: `image-${message.id}-${index}`, src: block.src }
        const last = items.at(-1)
        if (last?.kind === 'images') last.images.push(image)
        else items.push({ kind: 'images', key: image.key, images: [image] })
        return
      }
      const last = items.at(-1)
      if (last?.kind === 'tools') {
        last.toolCalls.push(block.toolCall)
        return
      }
      items.push({ kind: 'tools', key: `tools-${block.toolCall.id}`, toolCalls: [block.toolCall] })
    })
  }
  return items
}

function MessageImageGallery({
  images,
  isUser,
  onOpenImage,
  onOpenImageMenu,
}: {
  images: Array<{ key: string; src: string }>
  isUser: boolean
  onOpenImage(image: AgentPreviewImage): void
  onOpenImageMenu: OpenAgentImageMenu
}) {
  const galleryImages = images.map((image, index): AgentPreviewImage => ({
    id: image.key,
    src: image.src,
    alt: images.length === 1
      ? isUser ? 'Attachment from you' : 'Image from assistant'
      : isUser
        ? `Attachment ${index + 1} of ${images.length} from you`
        : `Image ${index + 1} of ${images.length} from assistant`,
    title: isUser ? 'Your attachment' : 'Assistant image',
    filename: isUser ? `your-attachment-${index + 1}` : `assistant-image-${index + 1}`,
  }))

  return (
    <AgentImageGallery
      images={galleryImages}
      label={isUser ? 'Images from you' : 'Images from assistant'}
      onOpenImage={onOpenImage}
      onOpenImageMenu={onOpenImageMenu}
    />
  )
}

// Exception #2: React.memo re-render bailout on a hot, list-rendered component
// (one per text block, re-rendered on every streaming delta).
const MarkdownText = memo(function MarkdownText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const html = renderMarkdownToHtml(text)
  // Empty/whitespace-only blocks don't render at all (avoids stray cards
  // around stripped-out tool blocks during streaming).
  if (!html) return null
  return (
    <div
      className={cn(styles.prose, className)}
      // Safe: sanitised by DOMPurify (via sanitizeRichtext) before reaching here.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
