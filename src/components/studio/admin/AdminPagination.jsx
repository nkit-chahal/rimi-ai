import React, { useMemo, useState } from 'react';

export function useClientPagination(items, pageSize = 20) {
    const [page, setPage] = useState(1);
    const total = items?.length || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    const pageItems = useMemo(() => {
        const list = items || [];
        const start = (safePage - 1) * pageSize;
        return list.slice(start, start + pageSize);
    }, [items, safePage, pageSize]);

    return {
        page: safePage,
        setPage,
        pageSize,
        total,
        totalPages,
        pageItems,
        rangeStart: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
        rangeEnd: Math.min(safePage * pageSize, total),
    };
}

export default function AdminPagination({
    page,
    totalPages,
    total,
    rangeStart,
    rangeEnd,
    onPageChange,
    label = 'rows',
}) {
    if (total <= 0) return null;

    return (
        <div className="admin-pagination">
            <span className="admin-pagination-meta">
                {rangeStart}–{rangeEnd} of {total.toLocaleString()} {label}
            </span>
            <div className="admin-pagination-controls">
                <button type="button" className="admin-action-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                    Prev
                </button>
                <span className="admin-pagination-page">Page {page} / {totalPages}</span>
                <button type="button" className="admin-action-btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                    Next
                </button>
            </div>
        </div>
    );
}
