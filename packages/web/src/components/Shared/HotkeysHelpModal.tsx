import React from 'react';
import { Modal } from './Modal.js';

interface HotkeysHelpModalProps {
    onClose: () => void;
}

export const HotkeysHelpModal: React.FC<HotkeysHelpModalProps> = ({ onClose }) => {
    const isMac = typeof window !== 'undefined' && 
        (/Mac|iPhone|iPod|iPad/.test(navigator.platform) || 
         /Macintosh|MacIntel|MacPPC|Mac68K/.test(navigator.userAgent));

    const modKey = isMac ? '⌘' : 'Ctrl';
    const altKey = isMac ? '⌥' : 'Alt';

    return (
        <Modal title="Keyboard Shortcuts" onClose={onClose} width="450px">
            <div className="hotkeys-grid">
                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Show/Hide Help Menu</span>
                    <div className="hotkeys-keys">
                        <kbd>?</kbd> <span className="hotkeys-or">or</span> <kbd>Shift</kbd> + <kbd>?</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Trigger / Run Fuzzer</span>
                    <div className="hotkeys-keys">
                        <kbd>{modKey}</kbd> + <kbd>Enter</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Pause / Resume Fuzzer</span>
                    <div className="hotkeys-keys">
                        <kbd>{modKey}</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Stop Fuzzing Session</span>
                    <div className="hotkeys-keys">
                        <kbd>{modKey}</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Toggle Left Sidebar (History)</span>
                    <div className="hotkeys-keys">
                        <kbd>{altKey}</kbd> + <kbd>L</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Toggle Right Sidebar (Config)</span>
                    <div className="hotkeys-keys">
                        <kbd>{altKey}</kbd> + <kbd>C</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Close Modals / Details / Sidebars</span>
                    <div className="hotkeys-keys">
                        <kbd>Esc</kbd>
                    </div>
                </div>

                <div className="hotkeys-row">
                    <span className="hotkeys-desc">Switch Tabs (Heatmap, Logs, etc.)</span>
                    <div className="hotkeys-keys">
                        <kbd>1</kbd> .. <kbd>4</kbd>
                    </div>
                </div>
            </div>
            <div className="hotkeys-note">
                Note: Keyboard shortcuts are inactive when focus is in an input field.
            </div>
        </Modal>
    );
};
