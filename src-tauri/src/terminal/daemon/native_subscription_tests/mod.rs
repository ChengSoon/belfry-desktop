mod fixture;
mod probe;

use self::{
    fixture::{Fixture, payload, wait_for},
    probe::Stream,
};
use crate::terminal::{contracts::TerminalStatus, native_tests::lock_native_test};
use std::time::Instant;

const BEGIN: &[u8] = b"<native-begin>\n";
const END: &[u8] = b"<native-end>\n";
const INPUT: &str = "输入状态怀念𠀁";
const REPEATS: usize = 8;
const ORDERED_SCRIPT: &str = "printf '<native-begin>\\n'\n/bin/cat payload\n\
    printf '<native-end>\\n'\nprintf done > produced\n";
const SLOW_SCRIPT: &str = "printf '<native-begin>\\n'\n\
    for round in 1 2 3 4 5 6 7 8; do /bin/cat payload; done\n\
    printf done > produced\nIFS= read -r input\nprintf '%s' \"$input\" > input\n\
    printf '<native-input>%s\\n' \"$input\"\nprintf '<native-end>\\n'\n";
const RECONNECT_SCRIPT: &str = "printf '<native-begin>\\n'\n/bin/cat payload\n\
    while IFS= read -r input; do\n\
      printf '%s\\n' \"$input\" >> inputs\n\
      printf '<native-input>%s\\n' \"$input\"\n\
      if test \"$input\" = finish; then break; fi\n\
    done\nprintf '<native-end>\\n'\n";

#[test]
fn native_pty_poll_ack_preserves_output_and_waits_for_final_exit_ack() {
    let _guard = lock_native_test();
    let fixture = Fixture::new(ORDERED_SCRIPT);
    let payload = payload();
    fixture.put("payload", &payload);
    let started = Instant::now();
    let mut probe = fixture.open(None);
    fixture.wait_file("produced", b"done");
    fixture.wait_status(&probe.session.id, TerminalStatus::Exited);
    wait_for("unacknowledged native output", || {
        !probe.snapshot().pending.is_empty()
    });
    let stalled = probe.snapshot();
    assert!(stalled.bytes < payload.len());
    eprintln!(
        "native ACK ordered: produced_bytes={}, exited_before_first_ack=true, production_ms={:.2}, stalled_bytes={}, stalled_batches={}",
        payload.len(),
        started.elapsed().as_secs_f64() * 1000.0,
        stalled.bytes,
        stalled.pending.len()
    );
    let stream = probe.drain(&fixture.client, Stream::default());
    assert_eq!(0, stream.gaps);
    let expected = [BEGIN, payload.as_slice(), END].concat();
    assert_eq!(expected.len(), stream.bytes.len());
    assert!(
        expected == stream.bytes,
        "native output bytes changed or reordered"
    );
    stream.report("ordered", &probe.snapshot());
}

#[test]
fn native_pty_slow_ack_reports_gap_and_keeps_real_input_working() {
    let _guard = lock_native_test();
    let fixture = Fixture::new(SLOW_SCRIPT);
    let payload = payload();
    fixture.put("payload", &payload);
    let mut probe = fixture.open(None);
    fixture.wait_file("produced", b"done");
    fixture.wait_status(&probe.session.id, TerminalStatus::Running);
    wait_for("stalled native output", || {
        !probe.snapshot().pending.is_empty()
    });
    let stalled = probe.snapshot();
    let input_started = Instant::now();
    fixture.send_line(&probe.session.id, INPUT);
    fixture.wait_file("input", INPUT.as_bytes());
    let input_ms = input_started.elapsed().as_secs_f64() * 1000.0;
    fixture.wait_status(&probe.session.id, TerminalStatus::Exited);
    let stream = probe.drain(&fixture.client, Stream::default());
    assert!(stream.gaps > 0 && stream.dropped_events > 0);
    let tail_len = assert_retained_suffix(&stream, &payload);
    eprintln!(
        "native ACK slow: produced_bytes={}, input_file_roundtrip_ms={input_ms:.2}, stalled_bytes={}, stalled_batches={}, exact_tail_bytes={}",
        payload.len() * REPEATS,
        stalled.bytes,
        stalled.pending.len(),
        tail_len
    );
    stream.report("slow", &probe.snapshot());
}

#[test]
fn native_pty_detach_reconnect_preserves_process_and_rejects_stale_ack() {
    let _guard = lock_native_test();
    let fixture = Fixture::new(RECONNECT_SCRIPT);
    let payload = payload();
    fixture.put("payload", &payload);
    let mut old = fixture.open(None);
    fixture.wait_file("starts", b"start\n");
    let pid = fixture.read("pid");
    assert!(!pid.is_empty());
    let stale_delivery = old.receive().id;
    fixture.client.detach(&old.session.id, old.connection());
    old.wait_detached();
    fixture.send_line(&old.session.id, INPUT);
    fixture.wait_file("inputs", format!("{INPUT}\n").as_bytes());
    fixture.wait_status(&old.session.id, TerminalStatus::Running);
    let mut current = fixture.open(Some(&old.session.id));
    assert_eq!(old.session.id, current.session.id);
    assert!(!old.session.reconnected && current.session.reconnected);
    assert_ne!(old.connection(), current.connection());
    assert_eq!(pid, fixture.read("pid"));
    assert_eq!(b"start\n", fixture.read("starts").as_slice());
    let stream = current.resume_with_isolated_ack(&fixture.client, &old);
    fixture.send_line(&current.session.id, "finish");
    let stream = current.drain(&fixture.client, stream);
    let responses = format!("<native-input>{INPUT}\n<native-input>finish\n");
    let expected = [BEGIN, payload.as_slice(), responses.as_bytes(), END].concat();
    assert_eq!(0, stream.gaps);
    assert!(
        expected == stream.bytes,
        "reconnected replay lost or duplicated native output"
    );
    fixture.wait_file("inputs", format!("{INPUT}\nfinish\n").as_bytes());
    assert_eq!(pid, fixture.read("pid"));
    assert_eq!(b"start\n", fixture.read("starts").as_slice());
    eprintln!(
        "native ACK reconnect: same_pty_pid={}, startup_count=1, old_delivery={stale_delivery}, offline_input_replayed=true",
        String::from_utf8(pid).unwrap()
    );
    stream.report("reconnect", &current.snapshot());
}

fn assert_retained_suffix(stream: &Stream, payload: &[u8]) -> usize {
    let input_echo = format!("<native-input>{INPUT}\n");
    let expected = [
        BEGIN,
        payload.repeat(REPEATS).as_slice(),
        input_echo.as_bytes(),
        END,
    ]
    .concat();
    let tail = &stream.bytes[stream.tail_start..];
    assert!(
        expected.ends_with(tail),
        "retained output is not the exact native suffix"
    );
    assert!(tail.ends_with(&[input_echo.as_bytes(), END].concat()));
    assert!(
        tail.len() > payload.len(),
        "gap check must cover a substantial retained tail"
    );
    assert!(stream.bytes.len() < expected.len());
    tail.len()
}
