import React, { useMemo, useState } from 'react';
import type { EndpointConfig } from '@swazz/core';

interface EndpointTreeProps {
    endpoints: EndpointConfig[];
    disabledEndpoints: string[];
    onUpdateDisabled: (disabled: string[]) => void;
}

type EndpointLeaf = {
    id: string;
    method: string;
    path: string;
    fieldCount: number;
};

type TreeNode = {
    name: string;
    children: Record<string, TreeNode>;
    endpoints: EndpointLeaf[];
};

function processPath(path: string): string[] {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return ['/'];

    // Level 1: e.g. /api
    const res = [`/${parts[0]}`];

    // Level 2: e.g. auth
    if (parts.length > 1) {
        res.push(parts[1]);
    }

    // Level 3: e.g. team
    if (parts.length > 2) {
        res.push(parts[2]);
    }

    // Level 4: e.g. /invite...
    if (parts.length > 3) {
        res.push(parts.slice(3).join('/'));
    }

    return res;
}

function getAllEndpointIds(node: TreeNode): string[] {
    let ids = [...node.endpoints.map((e) => e.id)];
    for (const child of Object.values(node.children)) {
        ids = ids.concat(getAllEndpointIds(child));
    }
    return ids;
}

function getMethodColor(method: string) {
    switch (method.toUpperCase()) {
        case 'GET': return 'var(--color-success)';
        case 'POST': return 'var(--color-primary)';
        case 'PUT': return 'var(--color-warning)';
        case 'DELETE': return 'var(--color-error)';
        case 'PATCH': return 'var(--color-warning)';
        default: return 'var(--text-primary)';
    }
}

export function EndpointTree({ endpoints, disabledEndpoints, onUpdateDisabled }: EndpointTreeProps) {
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

    const toggleExpand = (nodePath: string) => {
        setExpandedNodes((prev) => ({
            ...prev,
            [nodePath]: prev[nodePath] === undefined ? false : !prev[nodePath], // default is true implicitly
        }));
    };

    const tree = useMemo(() => {
        const root: TreeNode = { name: 'root', children: {}, endpoints: [] };

        for (const ep of endpoints) {
            const segments = processPath(ep.path);
            let current = root;
            for (const seg of segments) {
                if (!current.children[seg]) {
                    current.children[seg] = { name: seg, children: {}, endpoints: [] };
                }
                current = current.children[seg];
            }
            current.endpoints.push({
                id: `${ep.method} ${ep.path}`,
                method: ep.method,
                path: ep.path,
                fieldCount: ep.schema?.properties ? Object.keys(ep.schema.properties).length : 0,
            });
        }
        return root;
    }, [endpoints]);

    const renderNode = (node: TreeNode, currentPath: string, depth: number = 0) => {
        const allIds = getAllEndpointIds(node);
        if (allIds.length === 0 && node.name !== 'root') return null;

        const disabledCount = allIds.filter((id) => disabledEndpoints.includes(id)).length;
        const checked = disabledCount === 0;
        const indeterminate = disabledCount > 0 && disabledCount < allIds.length;

        const toggleNode = () => {
            if (checked || indeterminate) {
                // Disable all
                const toDisable = allIds.filter((id) => !disabledEndpoints.includes(id));
                onUpdateDisabled([...disabledEndpoints, ...toDisable]);
            } else {
                // Enable all
                const next = disabledEndpoints.filter((id) => !allIds.includes(id));
                onUpdateDisabled(next);
            }
        };

        const hasChildren = Object.keys(node.children).length > 0;
        const isLeaf = !hasChildren && node.name !== 'root';
        const displayName = node.name + (hasChildren && node.name !== '/' ? '/' : '');

        const nodeKey = currentPath ? `${currentPath}/${node.name}` : node.name;
        // Default expanded: true. If explicitly false in state, then collapsed.
        const isExpanded = expandedNodes[nodeKey] !== false;

        const content = (
            <div key={nodeKey} style={{ marginLeft: depth === 0 ? 0 : 16, marginTop: depth === 0 ? 0 : 4 }}>
                {node.name !== 'root' && !isLeaf && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                        <button
                            onClick={() => toggleExpand(nodeKey)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-disabled)',
                                fontSize: 10,
                                cursor: 'pointer',
                                padding: '2px',
                                width: 14,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {isExpanded ? '▼' : '▶'}
                        </button>
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={checked}
                            ref={(el) => {
                                if (el) el.indeterminate = indeterminate;
                            }}
                            onChange={toggleNode}
                        />
                        <span
                            style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all', cursor: 'pointer' }}
                            onClick={() => toggleExpand(nodeKey)}
                        >
                            {displayName}
                        </span>
                    </div>
                )}

                {(isExpanded || node.name === 'root') && (
                    <div style={{ marginLeft: node.name !== 'root' && !isLeaf ? 8 : 0, borderLeft: node.name !== 'root' && !isLeaf ? '1px solid var(--border-subtle)' : 'none', paddingLeft: node.name !== 'root' && !isLeaf ? 8 : 0 }}>
                        {Object.values(node.children).map((child) => renderNode(child, nodeKey, depth + 1))}

                        {node.endpoints.map((ep) => {
                            const isChecked = !disabledEndpoints.includes(ep.id);
                            return (
                                <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginLeft: isLeaf ? 0 : 28 }}>
                                    <input
                                        type="checkbox"
                                        className="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                            if (isChecked) {
                                                onUpdateDisabled([...disabledEndpoints, ep.id]);
                                            } else {
                                                onUpdateDisabled(disabledEndpoints.filter((id) => id !== ep.id));
                                            }
                                        }}
                                    />
                                    <span style={{ fontSize: 10, fontWeight: 600, width: 40, color: getMethodColor(ep.method) }}>
                                        {ep.method}
                                    </span>
                                    {isLeaf ? (
                                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                                            {node.name}
                                        </span>
                                    ) : (
                                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                            /
                                        </span>
                                    )}
                                    {ep.fieldCount > 0 && (
                                        <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                                            {ep.fieldCount} fields
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );

        return content;
    };

    if (endpoints.length === 0) {
        return (
            <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)' }}>
                Add endpoints manually or load from Swagger
            </div>
        );
    }

    return (
        <div className="endpoint-tree" style={{ padding: '8px 0' }}>
            {renderNode(tree, '')}
        </div>
    );
}
