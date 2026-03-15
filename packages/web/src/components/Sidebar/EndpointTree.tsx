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
    const res = [`/${parts[0]}`];
    if (parts.length > 1) res.push(parts[1]);
    if (parts.length > 2) res.push(parts[2]);
    if (parts.length > 3) res.push(parts.slice(3).join('/'));
    return res;
}

function getAllEndpointIds(node: TreeNode): string[] {
    let ids = [...node.endpoints.map((e) => e.id)];
    for (const child of Object.values(node.children)) {
        ids = ids.concat(getAllEndpointIds(child));
    }
    return ids;
}

export function EndpointTree({ endpoints, disabledEndpoints, onUpdateDisabled }: EndpointTreeProps) {
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

    const toggleExpand = (nodePath: string) => {
        setExpandedNodes((prev) => ({
            ...prev,
            [nodePath]: prev[nodePath] === undefined ? false : !prev[nodePath],
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
                const toDisable = allIds.filter((id) => !disabledEndpoints.includes(id));
                onUpdateDisabled([...disabledEndpoints, ...toDisable]);
            } else {
                const next = disabledEndpoints.filter((id) => !allIds.includes(id));
                onUpdateDisabled(next);
            }
        };

        const hasChildren = Object.keys(node.children).length > 0;
        const isLeaf = !hasChildren && node.name !== 'root';
        const displayName = node.name + (hasChildren && node.name !== '/' ? '/' : '');
        const nodeKey = currentPath ? `${currentPath}/${node.name}` : node.name;
        const isExpanded = expandedNodes[nodeKey] !== false;

        return (
            <div key={nodeKey} className="tree-node" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
                {node.name !== 'root' && !isLeaf && (
                    <div className="tree-node-row">
                        <button className="tree-chevron" onClick={() => toggleExpand(nodeKey)} data-expanded={isExpanded}>
                            ▶
                        </button>
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={checked}
                            ref={(el) => { if (el) el.indeterminate = indeterminate; }}
                            onChange={toggleNode}
                        />
                        <span className="tree-node-name" onClick={() => toggleExpand(nodeKey)}>
                            {displayName}
                        </span>
                    </div>
                )}

                {(isExpanded || node.name === 'root') && (
                    <div className="tree-children" data-root={node.name === 'root'}>
                        {Object.values(node.children).map((child) => renderNode(child, nodeKey, depth + 1))}

                        {node.endpoints.map((ep) => {
                            const isChecked = !disabledEndpoints.includes(ep.id);
                            return (
                                <div key={ep.id} className="tree-leaf-row">
                                    <input
                                        type="checkbox"
                                        className="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                            if (isChecked) onUpdateDisabled([...disabledEndpoints, ep.id]);
                                            else onUpdateDisabled(disabledEndpoints.filter((id) => id !== ep.id));
                                        }}
                                    />
                                    <span className={`method method-${ep.method.toLowerCase()}`} style={{ fontSize:9, width:36 }}>
                                        {ep.method}
                                    </span>
                                    <span className="tree-leaf-name">
                                        {isLeaf ? node.name : '/'}
                                    </span>
                                    {ep.fieldCount > 0 && (
                                        <span className="tree-leaf-meta">{ep.fieldCount} fields</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    if (endpoints.length === 0) {
        return (
            <div className="empty-state-small">
                Add endpoints manually or load from Swagger
            </div>
        );
    }

    return (
        <div className="endpoint-tree">
            {renderNode(tree, '')}
        </div>
    );
}
