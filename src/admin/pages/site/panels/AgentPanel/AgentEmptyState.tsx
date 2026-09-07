/**
 * Empty-state and credential-lock surfaces for the AI assistant thread, plus
 * the "AI settings" shortcut button shared by the header, the empty states,
 * and the inline credential notice.
 */
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'
import { AiBoxSolidIcon } from 'pixel-art-icons/icons/ai-box-solid'
import { AiSettingsSolidIcon } from 'pixel-art-icons/icons/ai-settings-solid'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { cn } from '@ui/cn'
import type { ComposerLockReason } from './AgentComposer'
import threadStyles from './AgentThread.module.css'
import styles from './AgentEmptyState.module.css'

const AI_SETTINGS_ROUTE = '/admin/ai'

export function AgentEmptyState({ mode }: { mode: ComposerLockReason | 'prompt' }) {
  if (mode === 'setup') {
    return (
      <EmptyState
        variant="centered"
        size="default"
        role="alert"
        icon={<AiSettingsSolidIcon size={20} className={styles.emptyIcon} />}
        title="Connect an AI provider"
        description="Add a provider credential, then choose a default model before starting a chat."
        action={<AgentSettingsButton variant="emptyState" label="Open AI settings" />}
      />
    )
  }

  if (mode === 'chooseModel') {
    return (
      <EmptyState
        variant="centered"
        size="default"
        role="alert"
        icon={<AiSettingsSolidIcon size={20} className={styles.emptyIcon} />}
        title="Choose a model to get started"
        description="Pick a model below, or set a default in AI settings so it's ready every time you open this chat."
        action={<AgentSettingsButton variant="emptyState" label="Set a default in AI settings" />}
      />
    )
  }

  return (
    <EmptyState
      variant="centered"
      size="default"
      icon={<AiBoxSolidIcon size={18} className={styles.emptyIcon} />}
      title="Describe what you want to build and I'll do it for you."
      description={'Try: "Add a hero section with a heading and button"'}
    />
  )
}

/** Shown above an existing conversation when the composer is locked. */
export function AgentCredentialNotice({ mode }: { mode: ComposerLockReason }) {
  return (
    <div role="alert" className={cn(threadStyles.noticeLine, threadStyles.noticeLineWarning)}>
      <span>
        {mode === 'setup'
          ? 'No AI provider credentials are configured yet.'
          : 'Choose a model below, or set a default in AI settings.'}
      </span>
      <AgentSettingsButton
        variant="inline"
        label={mode === 'setup' ? 'Open AI settings' : 'Set a default'}
      />
    </div>
  )
}

export function AgentSettingsButton({
  variant,
  label,
  'data-testid': testId,
}: {
  variant: 'header' | 'emptyState' | 'inline'
  label: string
  'data-testid'?: string
}) {
  const navigate = useAdminNavigate()

  function openAiSettings() {
    navigate(AI_SETTINGS_ROUTE)
  }

  if (variant === 'header') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        iconOnly
        onClick={openAiSettings}
        tooltip={label}
        aria-label={label}
        data-testid={testId}
        className={styles.settingsButtonHeader}
      >
        <AiSettingsSolidIcon size={12} aria-hidden="true" />
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={variant === 'emptyState' ? 'sm' : 'xs'}
      onClick={openAiSettings}
      aria-label={label}
      data-testid={testId}
      className={variant === 'inline' ? styles.settingsButtonInline : undefined}
    >
      {label}
    </Button>
  )
}
