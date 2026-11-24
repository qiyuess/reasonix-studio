package sessionstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"reasonix/internal/contract/provider"
)

func replaySessionEventRecords(path string, limits sessionReplayLimits) (sessionEventReplay, error) {
	return replaySessionEventRecordsFrom(path, limits, -1)
}

// replaySessionEventRecordsFrom replays the log from an absolute byte offset.
// A negative offset asks for the newest snapshot record: everything before it
// was replaced wholesale, so reading it would only decode state already
// superseded — on a long session rewritten many times that is most of the file.
func replaySessionEventRecordsFrom(path string, limits sessionReplayLimits, from int64) (sessionEventReplay, error) {
	f, err := os.Open(path)
	if err != nil {
		return sessionEventReplay{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return sessionEventReplay{}, err
	}
	replay := sessionEventReplay{size: info.Size()}
	if info.Size() > limits.maxBytes {
		return replay, sessionReplayLimitError(path, "encoded_bytes", info.Size(), limits.maxBytes)
	}
	start := replayStart(f, info.Size(), from)
	if start > 0 {
		if _, err := f.Seek(start, io.SeekStart); err != nil {
			start = 0
			if _, err := f.Seek(0, io.SeekStart); err != nil {
				return replay, err
			}
		}
	}
	reader := newSessionRecordReaderAt(limits.reader(f), path, limits.maxBytes, start)
	for {
		if err := limits.err(); err != nil {
			return replay, err
		}
		raw, _, err := reader.next()
		if err != nil {
			if err := limits.err(); err != nil {
				return replay, err
			}
			if errors.Is(err, ErrSessionReplayLimitExceeded) {
				return replay, err
			}
			if errors.Is(err, io.EOF) {
				return replay, nil
			}
			replay.damaged = true
			return replay, nil
		}
		var rec sessionEventWireRecord
		if err := json.Unmarshal(raw, &rec); err != nil {
			replay.damaged = true
			return replay, nil
		}
		if !nativeSessionEventSchema(rec.SchemaVersion) {
			return replay, fmt.Errorf("decode session event log %s: unsupported schema version %d", path, rec.SchemaVersion)
		}
		if replay.records >= limits.maxRecords {
			return replay, sessionReplayLimitError(path, "event_records", int64(replay.records+1), int64(limits.maxRecords))
		}
		stop, err := applySessionEventRecord(path, rec, &replay, limits)
		if err != nil {
			return replay, err
		}
		if stop {
			return replay, nil
		}
		replay.records++
		replay.lastGoodEnd = reader.offset
	}
}

// replayStart chooses the byte offset a replay may jump to. A jump is only
// sound when it lands exactly on a snapshot record; anything else reads from
// the top, which is always correct, merely slower.
func replayStart(f *os.File, size, from int64) int64 {
	start := from
	if start < 0 {
		start = 0
		if off, ok := scanLastSnapshot(f, size); ok {
			start = off
		}
	}
	if start > 0 && (start >= size || !isSnapshotRecordAt(f, start, size)) {
		return 0
	}
	return start
}

func applySessionEventRecord(path string, rec sessionEventWireRecord, replay *sessionEventReplay, limits sessionReplayLimits) (bool, error) {
	switch rec.Type {
	case sessionEventTypeReplace:
		return replayReplaceEvent(path, rec, replay, limits)
	case sessionEventTypeAppend:
		return replayAppendEvent(path, rec, replay, limits)
	default:
		return false, fmt.Errorf("decode session event log %s: unsupported event type %q", path, rec.Type)
	}
}

func replayReplaceEvent(path string, rec sessionEventWireRecord, replay *sessionEventReplay, limits sessionReplayLimits) (bool, error) {
	if limits.tailBudget == 0 {
		if err := limits.payloadErr(path, int64(len(rec.Messages))); err != nil {
			return false, err
		}
	}
	replay.dropped, replay.sizes = 0, nil
	msgs, collectionItems, err := decodeReplayMessages(path, rec, 0, 0, limits)
	if err != nil {
		if errors.Is(err, ErrSessionReplayLimitExceeded) || limits.err() != nil {
			return false, err
		}
		replay.damaged = true
		return true, nil
	}
	replay.msgs = msgs
	replay.payloadBytes = int64(len(rec.Messages))
	replay.collectionItems = collectionItems
	replay.times = make([]time.Time, len(replay.msgs))
	replay.trimToTail(limits)
	return false, nil
}

func replayAppendEvent(path string, rec sessionEventWireRecord, replay *sessionEventReplay, limits sessionReplayLimits) (bool, error) {
	if rec.MessageIndex != replay.dropped+len(replay.msgs) {
		replay.damaged = true
		return true, nil
	}
	if limits.tailBudget == 0 {
		if err := limits.payloadErr(path, replay.payloadBytes+int64(len(rec.Messages))); err != nil {
			return false, err
		}
	}
	msgs, collectionItems, err := decodeReplayMessages(path, rec, len(replay.msgs), replay.collectionItems, limits)
	if err != nil {
		if errors.Is(err, ErrSessionReplayLimitExceeded) || limits.err() != nil {
			return false, err
		}
		replay.damaged = true
		return true, nil
	}
	replay.msgs = append(replay.msgs, msgs...)
	replay.payloadBytes += int64(len(rec.Messages))
	replay.collectionItems = collectionItems
	for range msgs {
		replay.times = append(replay.times, rec.CreatedAt)
	}
	replay.trimToTail(limits)
	return false, nil
}

func decodeReplayMessages(path string, rec sessionEventWireRecord, baseMessages, baseItems int, limits sessionReplayLimits) ([]provider.Message, int, error) {
	msgs, collectionItems, err := decodeSessionEventMessages(path, rec.Messages, baseMessages, baseItems, limits)
	if err == nil {
		collectionItems, err = resolveSessionEventImages(path, msgs, rec.ImageBlobs, collectionItems, limits)
	}
	return msgs, collectionItems, err
}
