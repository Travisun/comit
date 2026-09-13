import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * Generic data-table primitives — the single table implementation for the
 * whole console. Every color routes through theme tokens (globals.css), so
 * restyling the theme restyles every table.
 *
 * Structure (Stripe new-chrome data tables):
 *   <DataTable>                 flat white surface, 1px hairline border
 *     <DataTableHead>           transparent, bottom hairline, 12px gray labels
 *       <tr><DataTableTh>…      12px horizontal padding, 8px vertical
 *     <DataTableBody>
 *       <tr><DataTableTd>…      hairline row separators, gray hover wash
 *
 * `DataTable` styles its rows through descendant selectors, so plain
 * <tr>/<th>/<td> children work too (keeps server-rendered pages simple).
 */

function DataTable({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
      <table
        className={cn(
          "w-full border-collapse text-left text-sm text-[color:var(--text-body)]",
          "[&_tbody>tr]:border-b [&_tbody>tr]:border-border [&_tbody>tr]:transition-colors",
          "[&_tbody>tr:last-child]:border-0 [&_tbody>tr:hover]:bg-[var(--hover)]",
          "[&_thead>tr]:border-b [&_thead>tr]:border-border [&_thead>tr]:text-xs [&_thead>tr]:text-muted-foreground",
          "[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:align-middle",
          "[&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function DataTableHead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "border-b border-border text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DataTableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:not(:last-child)]:border-b [&>tr:not(:last-child)]:border-border", className)} {...props} />;
}

function DataTableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border transition-colors last:border-0 hover:bg-[var(--hover)]", className)} {...props} />;
}

function DataTableTh({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("px-3 py-2 text-xs font-medium", className)} {...props} />;
}

function DataTableTd({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}

/** Number/date cell — tabular numerals, quiet color, right aligned. */
function DataTableNum({ className, ...props }: React.ComponentProps<"td">) {
  return <DataTableTd className={cn("text-right tabular-nums text-muted-foreground", className)} {...props} />;
}

/** Actions cell — right aligned, keeps action buttons compact. */
function DataTableActions({ className, ...props }: React.ComponentProps<"td">) {
  return <DataTableTd className={cn("text-right", className)} {...props} />;
}

export {
  DataTable,
  DataTableHead,
  DataTableBody,
  DataTableRow,
  DataTableTh,
  DataTableTd,
  DataTableNum,
  DataTableActions,
};
