import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./table";

type Row = { name: string; email: string; role: string };

const people = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    name: ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Margaret Hamilton"][i % 4],
    email: `person${i + 1}@alpha.test`,
    role: i % 5 === 0 ? "admin" : "member",
  }));

function Users({ rows }: { rows: Row[] }) {
  return (
    <Table>
      <TableCaption>{rows.length ? `${rows.length} people` : "No one yet. Add the first person above."}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.email}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell>{r.email}</TableCell>
            <TableCell>{r.role === "admin" ? <Badge>Admin</Badge> : "Member"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const meta = { title: "Foundations/Table", component: Table, parameters: { layout: "padded" } } satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Few: Story = { render: () => <Users rows={people(4)} /> };
export const Empty: Story = { render: () => <Users rows={[]} /> };
export const ManyRows: Story = { render: () => <Users rows={people(80)} /> };
export const LongNames: Story = {
  render: () => (
    <Users rows={[{ name: "Maria Magdalena Fernández de la Concepción y Ortega", email: "maria.magdalena.fernandez-de-la-concepcion@a-very-long-domain.example-company.test", role: "admin" }]} />
  ),
};
export const OnPhone: Story = { ...Few, globals: { viewport: { value: "phone" } } };
