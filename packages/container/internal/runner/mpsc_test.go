package runner

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestMPSCQueue_FIFOOrdering(t *testing.T) {
	q := NewMPSCQueue()

	// Push items
	q.Push(Event{Type: "1"})
	q.Push(Event{Type: "2"})
	q.Push(Event{Type: "3"})

	// Pop all
	head := q.PopAll()
	if head == nil {
		t.Fatal("expected queue to not be empty")
	}

	expected := []string{"1", "2", "3"}
	curr := head
	for _, exp := range expected {
		if curr == nil {
			t.Fatalf("expected node with type %s, got nil", exp)
		}
		if curr.Value.Type != exp {
			t.Fatalf("expected value %s, got %s", exp, curr.Value.Type)
		}
		curr = curr.Next
	}
	if curr != nil {
		t.Fatal("expected end of queue")
	}
}

func TestMPSCQueue_Notification(t *testing.T) {
	q := NewMPSCQueue()

	// Initially wait chan should be empty
	select {
	case <-q.WaitChan():
		t.Fatal("unexpected notification on empty queue")
	default:
	}

	// Push one item, should notify
	q.Push(Event{Type: "test"})

	select {
	case <-q.WaitChan():
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("expected notification after push")
	}

	// Pushing again shouldn't block, notify channel has buffer size 1
	q.Push(Event{Type: "test2"})

	// Drain
	q.PopAll()

	// WaitChan should be empty now (we would need a new push to trigger it again,
	// but note that notify channel has 1 item buffer, so we might need to read it if we didn't before)
	// Let's clear any outstanding notify
	select {
	case <-q.WaitChan():
	default:
	}

	// WaitChan should be empty
	select {
	case <-q.WaitChan():
		t.Fatal("unexpected notification after PopAll and clearing")
	default:
	}

	// Push again, should notify
	q.Push(Event{Type: "test3"})
	select {
	case <-q.WaitChan():
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("expected notification after new push")
	}
}

func TestMPSCQueue_ConcurrentProducers(t *testing.T) {
	q := NewMPSCQueue()
	numProducers := 50
	itemsPerProducer := 1000
	totalExpected := numProducers * itemsPerProducer

	var wg sync.WaitGroup
	wg.Add(numProducers)

	// Start producers
	for i := 0; i < numProducers; i++ {
		go func(producerID int) {
			defer wg.Done()
			for j := 0; j < itemsPerProducer; j++ {
				q.Push(Event{
					Type: "test",
					Data: fmt.Sprintf("p%d-i%d", producerID, j),
				})
			}
		}(i)
	}

	// Consumer collects all items
	collected := make(map[string]bool)
	var collectWg sync.WaitGroup
	collectWg.Add(1)

	go func() {
		defer collectWg.Done()
		count := 0
		timeout := time.After(5 * time.Second)

		for count < totalExpected {
			select {
			case <-q.WaitChan():
				nodes := q.PopAll()
				for nodes != nil {
					key, ok := nodes.Value.Data.(string)
					if ok {
						collected[key] = true
					}
					count++
					nodes = nodes.Next
				}
			case <-timeout:
				t.Errorf("timeout waiting for items, collected %d/%d", count, totalExpected)
				return
			}
		}
	}()

	wg.Wait()
	collectWg.Wait()

	if len(collected) != totalExpected {
		t.Errorf("expected %d unique items, got %d", totalExpected, len(collected))
	}
}
