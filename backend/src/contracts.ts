export type PlatformId = "windows" | "macos" | "linux";

export type ShellKind = "pwsh" | "powershell" | "cmd" | "zsh" | "bash" | "sh";

export type ProviderTransport = "pty" | "spawn" | "api";

export type SessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type EventScope = "backend" | "project" | "chat" | "session" | "git" | "voice";

export interface ShellDescriptor {
  kind: ShellKind;
  executable: string;
  args: string[];
}

export interface HostCapabilities {
  platform: PlatformId;
  platformVersion: string;
  preferredShell: ShellDescriptor;
  supportsPty: boolean;
  supportsVoiceCapture: boolean;
  gitExecutableCandidates: string[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  pathKey: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface CreateProjectInput {
  name: string;
  rootPath: string;
}

export interface ChatThreadRecord {
  id: string;
  projectId: string;
  title: string;
  providerId: string;
  paneId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatThreadInput {
  projectId: string;
  title: string;
  providerId: string;
  paneId: string;
}

export interface ChatMessageRecord {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface AppendChatMessageInput {
  threadId: string;
  role: MessageRole;
  content: string;
}

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  transport: ProviderTransport;
  executableCandidates: string[];
  supportedPlatforms: PlatformId[];
}

export interface SessionStartRequest {
  threadId: string;
  providerId: string;
  projectRoot: string;
  workingDirectory: string;
  command?: string[];
}

export interface SessionRecord {
  id: string;
  threadId: string;
  providerId: string;
  transport: ProviderTransport;
  workingDirectory: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
}

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export interface GitSnapshot {
  projectId: string;
  branchName: string;
  headSha?: string;
  changes: GitFileChange[];
  capturedAt: string;
}

export interface VoiceTranscript {
  threadId: string;
  text: string;
  createdAt: string;
}

export interface BackendEvent<TPayload = unknown> {
  id: string;
  scope: EventScope;
  entityId: string;
  type: string;
  occurredAt: string;
  payload: TPayload;
}

export interface WorkspaceStore {
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  createChatThread(input: CreateChatThreadInput): Promise<ChatThreadRecord>;
  appendMessage(input: AppendChatMessageInput): Promise<ChatMessageRecord>;
}

export interface ProviderRegistryPort {
  listProviders(): Promise<ProviderDescriptor[]>;
  startSession(request: SessionStartRequest): Promise<SessionRecord>;
  stopSession(sessionId: string): Promise<void>;
}

export interface GitServicePort {
  captureSnapshot(projectId: string, rootPath: string): Promise<GitSnapshot>;
}

export interface VoiceServicePort {
  transcribe(threadId: string, audioChunk: Buffer): Promise<VoiceTranscript>;
}
