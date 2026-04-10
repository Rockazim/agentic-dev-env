import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type {
  AppendChatMessageInput,
  BackendEvent,
  ChatMessageRecord,
  ChatThreadRecord,
  CreateChatThreadInput,
  CreateProjectInput,
  GitServicePort,
  GitSnapshot,
  HostCapabilities,
  ProjectRecord,
  ProviderDescriptor,
  ProviderRegistryPort,
  SessionRecord,
  SessionStartRequest,
  VoiceServicePort,
  VoiceTranscript,
  WorkspaceStore,
} from "./contracts";
import { detectHostCapabilities, normalizeWorkspacePath } from "./platform";

interface BackendDependencies {
  store: WorkspaceStore;
  providers: ProviderRegistryPort;
  git: GitServicePort;
  voice: VoiceServicePort;
  clock?: () => Date;
}

export class WorkspaceBackend extends EventEmitter {
  private readonly host: HostCapabilities;
  private readonly clock: () => Date;

  constructor(private readonly deps: BackendDependencies) {
    super();
    this.host = detectHostCapabilities();
    this.clock = deps.clock ?? (() => new Date());
  }

  getHostCapabilities(): HostCapabilities {
    return this.host;
  }

  async boot(): Promise<void> {
    this.emitEvent("backend", "workspace-backend", "backend/booted", {
      host: this.host,
    });
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.deps.store.listProjects();
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project = await this.deps.store.createProject({
      ...input,
      rootPath: normalizeWorkspacePath(input.rootPath, this.host.platform),
    });

    this.emitEvent("project", project.id, "project/created", project);

    return project;
  }

  async createChatThread(
    input: CreateChatThreadInput,
  ): Promise<ChatThreadRecord> {
    const thread = await this.deps.store.createChatThread(input);
    this.emitEvent("chat", thread.id, "chat/created", thread);
    return thread;
  }

  async appendMessage(
    input: AppendChatMessageInput,
  ): Promise<ChatMessageRecord> {
    const message = await this.deps.store.appendMessage(input);
    this.emitEvent("chat", message.threadId, "chat/message-appended", message);
    return message;
  }

  async listProviders(): Promise<ProviderDescriptor[]> {
    return this.deps.providers.listProviders();
  }

  async startSession(request: SessionStartRequest): Promise<SessionRecord> {
    const session = await this.deps.providers.startSession(request);
    this.emitEvent("session", session.id, "session/started", session);
    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.deps.providers.stopSession(sessionId);
    this.emitEvent("session", sessionId, "session/stopped", {
      sessionId,
    });
  }

  async captureGitSnapshot(
    projectId: string,
    rootPath: string,
  ): Promise<GitSnapshot> {
    const snapshot = await this.deps.git.captureSnapshot(projectId, rootPath);
    this.emitEvent("git", projectId, "git/status-updated", snapshot);
    return snapshot;
  }

  async transcribeVoice(
    threadId: string,
    audioChunk: Buffer,
  ): Promise<VoiceTranscript> {
    const transcript = await this.deps.voice.transcribe(threadId, audioChunk);
    this.emitEvent("voice", threadId, "voice/transcript-ready", transcript);
    return transcript;
  }

  private emitEvent<TPayload>(
    scope: BackendEvent<TPayload>["scope"],
    entityId: string,
    type: string,
    payload: TPayload,
  ): void {
    const event: BackendEvent<TPayload> = {
      id: randomUUID(),
      scope,
      entityId,
      type,
      occurredAt: this.clock().toISOString(),
      payload,
    };

    this.emit("event", event);
  }
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly threads = new Map<string, ChatThreadRecord>();
  private readonly messages = new Map<string, ChatMessageRecord[]>();

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: randomUUID(),
      name: input.name,
      rootPath: input.rootPath,
      pathKey: input.rootPath.toLowerCase(),
      createdAt: now,
      lastOpenedAt: now,
    };

    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return [...this.projects.values()];
  }

  async createChatThread(
    input: CreateChatThreadInput,
  ): Promise<ChatThreadRecord> {
    const now = new Date().toISOString();
    const thread: ChatThreadRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      providerId: input.providerId,
      paneId: input.paneId,
      createdAt: now,
      updatedAt: now,
    };

    this.threads.set(thread.id, thread);
    return thread;
  }

  async appendMessage(
    input: AppendChatMessageInput,
  ): Promise<ChatMessageRecord> {
    const message: ChatMessageRecord = {
      id: randomUUID(),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString(),
    };

    const current = this.messages.get(input.threadId) ?? [];
    current.push(message);
    this.messages.set(input.threadId, current);
    return message;
  }
}

export class StubProviderRegistry implements ProviderRegistryPort {
  async listProviders(): Promise<ProviderDescriptor[]> {
    return [
      {
        id: "codex",
        displayName: "Codex",
        transport: "pty",
        executableCandidates: ["codex"],
        supportedPlatforms: ["windows", "macos", "linux"],
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        transport: "pty",
        executableCandidates: ["claude"],
        supportedPlatforms: ["windows", "macos", "linux"],
      },
    ];
  }

  async startSession(request: SessionStartRequest): Promise<SessionRecord> {
    return {
      id: randomUUID(),
      threadId: request.threadId,
      providerId: request.providerId,
      transport: "pty",
      workingDirectory: request.workingDirectory,
      status: "starting",
      startedAt: new Date().toISOString(),
    };
  }

  async stopSession(_sessionId: string): Promise<void> {
    return;
  }
}

export class StubGitService implements GitServicePort {
  async captureSnapshot(
    projectId: string,
    _rootPath: string,
  ): Promise<GitSnapshot> {
    return {
      projectId,
      branchName: "unknown",
      changes: [],
      capturedAt: new Date().toISOString(),
    };
  }
}

export class StubVoiceService implements VoiceServicePort {
  async transcribe(threadId: string, _audioChunk: Buffer): Promise<VoiceTranscript> {
    return {
      threadId,
      text: "",
      createdAt: new Date().toISOString(),
    };
  }
}
