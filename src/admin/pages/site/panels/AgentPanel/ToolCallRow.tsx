/**
 * ToolCallRow — one agent tool call as a flat activity row: icon well,
 * title · detail, then client-observed duration or a status glyph. Failed
 * rows add the error message underneath; colour-token writes add swatches;
 * screenshot-producing calls become an open disclosure over their gallery.
 *
 * `ActivityRow` is the bare presentational row, also used for "Thinking…".
 */
import type { CSSProperties, ReactNode } from 'react'
import type { AgentToolCall } from '@site/agent'
import { Tooltip } from '@ui/components/Tooltip'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import { CircleAlertSolidIcon } from 'pixel-art-icons/icons/circle-alert-solid'
import { FilePlusSolidIcon } from 'pixel-art-icons/icons/file-plus-solid'
import { LinkIcon } from 'pixel-art-icons/icons/link'
import { CodeIcon } from 'pixel-art-icons/icons/code'
import { PackageSolidIcon } from 'pixel-art-icons/icons/package-solid'
import { Copy2SolidIcon } from 'pixel-art-icons/icons/copy-2-solid'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { EditSolidIcon } from 'pixel-art-icons/icons/edit-solid'
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { MoveIcon } from 'pixel-art-icons/icons/move'
import { ContainerSolidIcon } from 'pixel-art-icons/icons/container-solid'
import { OpenSolidIcon } from 'pixel-art-icons/icons/open-solid'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { RulerDimensionSolidIcon } from 'pixel-art-icons/icons/ruler-dimension-solid'
import { ColorsSwatchSolidIcon } from 'pixel-art-icons/icons/colors-swatch-solid'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { UsersSolidIcon } from 'pixel-art-icons/icons/users-solid'
import { ZapSolidIcon } from 'pixel-art-icons/icons/zap-solid'
import { AgentImageGallery } from './AgentImageGallery'
import type { AgentPreviewImage, OpenAgentImageMenu } from './agentImageTypes'
import { getToolCallDisplay, extractColorSwatches, type ToolCallIcon } from './toolCallDisplay'
import styles from './AgentThread.module.css'

interface ActivityRowProps {
  icon: ReactNode
  title: string
  detail?: string
  /** Trailing duration / status glyph. */
  meta?: ReactNode
  tone?: 'danger'
  status?: AgentToolCall['status']
  /** Sub-content aligned to the label column (swatches, error text). */
  children?: ReactNode
}

/** Presentational grid row: icon well · title · detail · meta. The parent owns the a11y role and label. */
export function ActivityRow({ icon, title, detail, meta, tone, status, children }: ActivityRowProps) {
  return (
    <div className={styles.toolRow}>
      <span className={styles.toolIconWell} data-tone={tone} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.toolLabel} aria-hidden="true">
        <span className={styles.toolTitle}>{title}</span>
        {detail && <span className={styles.toolDetail}>{detail}</span>}
      </span>
      {meta && (
        <span className={styles.toolMeta} data-status={status} aria-hidden="true">
          {meta}
        </span>
      )}
      {children}
    </div>
  )
}

interface ToolCallRowProps {
  toolCall: AgentToolCall
  onOpenImage(image: AgentPreviewImage): void
  onOpenImageMenu: OpenAgentImageMenu
}

export function ToolCallRow({ toolCall, onOpenImage, onOpenImageMenu }: ToolCallRowProps) {
  const isPending = toolCall.status === 'pending'
  const isError = toolCall.status === 'error'
  const display = getToolCallDisplay(toolCall.actionType, toolCall.params)
  const swatches = extractColorSwatches(toolCall.actionType, toolCall.params)
  const accessibleStatus = isPending ? 'Running' : isError ? 'Failed' : 'Completed'
  const statusLabel = `${accessibleStatus} ${display.title}${display.detail ? ` — ${display.detail}` : ''}`
  const duration = toolCall.durationMs === undefined ? null : formatDuration(toolCall.durationMs)
  // The toolResult handler in the agent store already populates `result.error`.
  const errorMessage = isError ? toolCall.result?.error ?? 'Tool call failed.' : null
  const previewImages = (toolCall.previewImages ?? []).map((src, index): AgentPreviewImage => ({
    id: `${toolCall.id}-preview-${index}`,
    src,
    alt: `Image ${index + 1} captured while running ${toolCall.actionType}`,
    title: 'Tool result image',
    filename: `${toolCall.actionType}-${index + 1}`,
  }))
  const hasDisclosure = previewImages.length > 0

  const meta = isPending ? (
    <LoaderIcon size={11} />
  ) : (
    <>
      {duration && <span>{duration}</span>}
      {isError && <CircleAlertSolidIcon size={11} />}
    </>
  )
  const extras = (
    <>
      {swatches.length > 0 && (
        <div className={styles.toolSwatches} aria-hidden="true">
          {swatches.map((swatch) => (
            <Tooltip key={swatch.slug} content={`${swatch.slug} · ${swatch.value}`}>
              <span
                className={styles.toolSwatch}
                style={{ '--swatch': swatch.value } as CSSProperties}
              />
            </Tooltip>
          ))}
        </div>
      )}
      {errorMessage && (
        <p role="alert" className={styles.toolError}>
          {errorMessage}
        </p>
      )}
    </>
  )
  const row = (
    <ActivityRow
      icon={<ToolCallLeadingIcon icon={display.icon} />}
      title={display.title}
      detail={display.detail}
      meta={isPending || isError || duration ? meta : undefined}
      tone={display.tone === 'danger' ? 'danger' : undefined}
      status={toolCall.status}
    >
      {!hasDisclosure && extras}
    </ActivityRow>
  )

  if (!hasDisclosure) {
    return (
      <div role="status" aria-label={statusLabel}>
        {row}
      </div>
    )
  }

  // Screenshots stay in the DOM (default open); the summary only folds them away.
  return (
    <details className={styles.toolDisclosure} open>
      <summary aria-label={statusLabel}>
        {row}
        <ChevronDownIcon size={10} className={styles.toolChevron} aria-hidden="true" />
      </summary>
      <div className={styles.toolDisclosureBody}>
        {extras}
        <AgentImageGallery
          images={previewImages}
          label="Images captured by assistant tools"
          onOpenImage={onOpenImage}
          onOpenImageMenu={onOpenImageMenu}
        />
      </div>
    </details>
  )
}

function formatDuration(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`
}

// Per-tool category icon — signals what kind of action ran at a glance.
function ToolCallLeadingIcon({ icon }: { icon: ToolCallIcon }) {
  switch (icon) {
    case 'add': return <FilePlusSolidIcon size={12} />
    case 'class': return <LinkIcon size={12} />
    case 'code': return <CodeIcon size={12} />
    case 'collection': return <PackageSolidIcon size={12} />
    case 'copy': return <Copy2SolidIcon size={12} />
    case 'data': return <DatabaseSolidIcon size={12} />
    case 'delete': return <TrashSolidIcon size={12} />
    case 'document': return <FileTextSolidIcon size={12} />
    case 'edit': return <EditSolidIcon size={12} />
    case 'media': return <ImageSolidIcon size={12} />
    case 'move': return <MoveIcon size={12} />
    case 'node': return <ContainerSolidIcon size={12} />
    case 'open': return <OpenSolidIcon size={12} />
    case 'page': return <FileTextSolidIcon size={12} />
    case 'preview': return <EyeSolidIcon size={12} />
    case 'runtime': return <RulerDimensionSolidIcon size={12} />
    case 'style': return <ColorsSwatchSolidIcon size={12} />
    case 'template': return <LayoutSolidIcon size={12} />
    case 'tokens': return <ColorsSwatchSolidIcon size={12} />
    case 'users': return <UsersSolidIcon size={12} />
    case 'tool': return <ZapSolidIcon size={12} />
  }
}
