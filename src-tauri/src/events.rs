use crate::logging;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub enum AppEvent {
    ExecutionCompleted {
        run_id: String,
        session_uuid: Option<String>,
        outcome: String,
    },
    FileCreated {
        path: String,
    },
    FileSaved {
        path: String,
        content_hash: String,
    },
    WorkspaceChanged {
        root: String,
    },
}

pub fn publish(event: AppEvent) {
    logging::info(format!("App event: {}", event.describe()));
}

pub fn content_hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

impl AppEvent {
    fn describe(&self) -> String {
        match self {
            Self::ExecutionCompleted {
                run_id,
                session_uuid,
                outcome,
            } => format!(
                "execution.completed run_id={run_id} session_uuid={} outcome={outcome}",
                session_uuid.as_deref().unwrap_or("<new>")
            ),
            Self::FileCreated { path } => format!("file.created path={path}"),
            Self::FileSaved { path, content_hash } => {
                format!("file.saved path={path} content_hash={content_hash}")
            }
            Self::WorkspaceChanged { root } => format!("workspace.changed root={root}"),
        }
    }
}
