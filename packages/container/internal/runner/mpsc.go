package runner

import "sync/atomic"

// EventNode represents a node in the lock-free MPSC queue.
type EventNode struct {
	Value Event
	Next  *EventNode
}

// MPSCQueue is a lock-free multi-producer single-consumer queue.
// It uses an atomic stack for lock-free pushes and reverses the list for FIFO popping.
type MPSCQueue struct {
	head   atomic.Pointer[EventNode]
	notify chan struct{}
}

// NewMPSCQueue initializes a new lock-free queue.
func NewMPSCQueue() *MPSCQueue {
	return &MPSCQueue{
		notify: make(chan struct{}, 1),
	}
}

// Push adds an event to the queue lock-free. (Called by 1000s of fuzzer goroutines)
func (q *MPSCQueue) Push(val Event) {
	node := &EventNode{Value: val}
	for {
		head := q.head.Load()
		node.Next = head
		if q.head.CompareAndSwap(head, node) {
			// If the queue was empty, notify the consumer.
			if head == nil {
				select {
				case q.notify <- struct{}{}:
				default:
				}
			}
			return
		}
	}
}

// PopAll retrieves all pending events in FIFO order. (Called by the single broadcast loop)
func (q *MPSCQueue) PopAll() *EventNode {
	head := q.head.Swap(nil)
	if head == nil {
		return nil
	}

	// Reverse the stack to convert LIFO to FIFO
	var prev *EventNode
	curr := head
	for curr != nil {
		next := curr.Next
		curr.Next = prev
		prev = curr
		curr = next
	}

	return prev // prev is now the oldest event (first to be processed)
}

// WaitChan returns a channel to block the consumer until items arrive.
func (q *MPSCQueue) WaitChan() <-chan struct{} {
	return q.notify
}
