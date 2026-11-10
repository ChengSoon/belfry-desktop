use std::{
    sync::{Arc, mpsc},
    thread,
    time::Duration,
};

use super::input_gate::InputGate;
use belfry_protocol::inbox::{BindRequest, OfferRequest};

// A PTY write may wait for its child to read, while that child waits for stdout
// to drain. The output observer must therefore remain runnable during writes.
fn output_progresses_during_write(guarded: bool) {
    let gate = Arc::new(InputGate::default());
    let root = std::env::temp_dir();
    gate.register(
        "concurrent-pty",
        Some("concurrent-tab".into()),
        root.clone(),
    );
    gate.observe_output("concurrent-pty", 0, b"\x1b[?2004h");
    let binding = gate
        .bind(
            &BindRequest {
                tab_id: "concurrent-tab".into(),
                terminal_session_id: "concurrent-pty".into(),
                owner_id: "test".into(),
            },
            &root,
        )
        .unwrap();
    let offer = gate
        .offer(
            &OfferRequest {
                binding,
                offer_id: "input-slot".into(),
                running: true,
                idle: true,
                composer_empty: true,
                awaiting_input: false,
                prompt_queue_empty: true,
            },
            0,
        )
        .unwrap();
    let guard = gate
        .authorize(&offer, "batch", "attempt", "payload", 1)
        .unwrap();
    let mut observer = None;
    let mut progressed = false;
    let write = || {
        let output = gate.clone();
        let (sent, received) = mpsc::channel();
        observer = Some(thread::spawn(move || {
            output.observe_output("concurrent-pty", 1, b"output while a PTY write is pending");
            let _ = sent.send(());
        }));
        progressed = received.recv_timeout(Duration::from_secs(1)).is_ok();
        Ok(())
    };
    let result = if guarded {
        gate.guarded_write(
            "concurrent-pty",
            &guard,
            1,
            b"\x1b[200~payload\x1b[201~",
            write,
        )
    } else {
        gate.user_write("concurrent-pty", b"manual text", write)
    };
    // Even the old implementation releases its lock after the bounded wait,
    // allowing the observer to exit; this regression cannot leave a hung thread.
    observer.unwrap().join().unwrap();
    result.unwrap();
    assert!(
        progressed,
        "native output processing was blocked by the input write lock"
    );
}

#[test]
fn guarded_input_does_not_block_native_output_processing() {
    output_progresses_during_write(true);
}

#[test]
fn ordinary_input_does_not_block_native_output_processing() {
    output_progresses_during_write(false);
}
