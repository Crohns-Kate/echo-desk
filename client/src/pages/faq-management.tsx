import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Search,
  Tag
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Faq {
  id: number;
  tenantId?: number;
  category: string;
  question: string;
  answer: string;
  keywords?: string[];
  priority: number;
  isActive: boolean;
  createdAt?: string;
}

interface FaqFormData {
  category: string;
  question: string;
  answer: string;
  keywords: string;
  priority: number;
  isActive: boolean;
}

const categories = [
  { value: "hours", label: "Business Hours" },
  { value: "location", label: "Location & Directions" },
  { value: "parking", label: "Parking" },
  { value: "billing", label: "Billing & Insurance" },
  { value: "services", label: "Services Offered" },
  { value: "preparation", label: "Appointment Preparation" },
  { value: "cancellation", label: "Cancellation Policy" },
  { value: "first-visit", label: "First Visit" },
  { value: "urgent", label: "Urgent Care" },
  { value: "booking", label: "Booking Information" },
  { value: "general", label: "General" },
];

const defaultFormData: FaqFormData = {
  category: "general",
  question: "",
  answer: "",
  keywords: "",
  priority: 0,
  isActive: true,
};

export default function FaqManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, params] = useRoute("/tenants/:tenantId/faqs");
  const tenantId = params?.tenantId ? parseInt(params.tenantId, 10) : undefined;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<Faq | null>(null);
  const [formData, setFormData] = useState<FaqFormData>(defaultFormData);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: faqs, isLoading } = useQuery<Faq[]>({
    queryKey: [`/api/faqs`, tenantId],
    queryFn: async () => {
      const url = tenantId ? `/api/faqs?tenantId=${tenantId}` : `/api/faqs`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch FAQs");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FaqFormData) => {
      const res = await fetch("/api/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          tenantId,
          keywords: data.keywords.split(",").map(k => k.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create FAQ");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/faqs`, tenantId] });
      setIsCreateOpen(false);
      setFormData(defaultFormData);
      toast({ title: "FAQ created", description: "New FAQ has been added." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FaqFormData> }) => {
      const res = await fetch(`/api/faqs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          keywords: data.keywords?.split(",").map(k => k.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update FAQ");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/faqs`, tenantId] });
      setEditingFaq(null);
      setFormData(defaultFormData);
      toast({ title: "FAQ updated", description: "FAQ has been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/faqs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete FAQ");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/faqs`, tenantId] });
      toast({ title: "FAQ deleted", description: "FAQ has been removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openEditDialog = (faq: Faq) => {
    setEditingFaq(faq);
    setFormData({
      category: faq.category,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords?.join(", ") || "",
      priority: faq.priority,
      isActive: faq.isActive,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingFaq) {
      updateMutation.mutate({ id: editingFaq.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const filteredFaqs = faqs?.filter(faq => {
    const matchesSearch = searchTerm === "" ||
      faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || faq.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const FaqForm = () => (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(cat => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="question">Question</Label>
        <Input
          id="question"
          value={formData.question}
          onChange={(e) => setFormData({ ...formData, question: e.target.value })}
          placeholder="What are your opening hours?"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="answer">Answer</Label>
        <Textarea
          id="answer"
          value={formData.answer}
          onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
          placeholder="We're open Monday to Friday from 9am to 5pm..."
          rows={4}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="keywords">Keywords (comma-separated)</Label>
        <Input
          id="keywords"
          value={formData.keywords}
          onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
          placeholder="hours, open, closed, time"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="priority">Priority (higher = more important)</Label>
          <Input
            id="priority"
            type="number"
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 0 })}
            min={0}
            max={100}
          />
        </div>
        <div className="flex items-center justify-between pt-6">
          <Label htmlFor="isActive">Active</Label>
          <Switch
            id="isActive"
            checked={formData.isActive}
            onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => {
          setIsCreateOpen(false);
          setEditingFaq(null);
          setFormData(defaultFormData);
        }}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
          {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingFaq ? "Save Changes" : "Create FAQ"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Link href="/tenants">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              </Link>
            </div>
            <h1 className="text-2xl font-semibold text-foreground">FAQ Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage frequently asked questions for your clinic
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setFormData(defaultFormData); setEditingFaq(null); }}>
                <Plus className="h-4 w-4 mr-2" />
                Add FAQ
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Create New FAQ</DialogTitle>
                <DialogDescription>
                  Add a new frequently asked question and answer
                </DialogDescription>
              </DialogHeader>
              <FaqForm />
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search FAQs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* FAQs List */}
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-12">
                <div className="flex items-center justify-center">
                  <div className="animate-pulse text-sm text-muted-foreground">Loading FAQs...</div>
                </div>
              </CardContent>
            </Card>
          ) : !filteredFaqs || filteredFaqs.length === 0 ? (
            <Card>
              <CardContent className="p-12">
                <div className="flex flex-col items-center justify-center space-y-3 text-center">
                  <HelpCircle className="h-12 w-12 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No FAQs found</p>
                    <p className="text-xs text-muted-foreground">
                      {searchTerm || categoryFilter !== "all"
                        ? "Try adjusting your search or filters"
                        : "Click \"Add FAQ\" to create your first FAQ"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            filteredFaqs.map((faq) => (
              <Card key={faq.id} className={`hover:shadow-md transition-shadow ${!faq.isActive ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">
                          <Tag className="h-3 w-3 mr-1" />
                          {categories.find(c => c.value === faq.category)?.label || faq.category}
                        </Badge>
                        {!faq.isActive && <Badge variant="secondary">Inactive</Badge>}
                        {faq.priority > 0 && (
                          <Badge variant="outline" className="text-xs">Priority: {faq.priority}</Badge>
                        )}
                      </div>
                      <CardTitle className="text-base">{faq.question}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      <Dialog open={editingFaq?.id === faq.id} onOpenChange={(open) => !open && setEditingFaq(null)}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => openEditDialog(faq)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-xl">
                          <DialogHeader>
                            <DialogTitle>Edit FAQ</DialogTitle>
                            <DialogDescription>
                              Update this FAQ entry
                            </DialogDescription>
                          </DialogHeader>
                          <FaqForm />
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this FAQ?")) {
                            deleteMutation.mutate(faq.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{faq.answer}</p>
                  {faq.keywords && faq.keywords.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {faq.keywords.map((kw, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
