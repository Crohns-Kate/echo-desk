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
import { Checkbox } from "@/components/ui/checkbox";
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
  Tag,
  BarChart3,
  Clock,
  Volume2,
  Sparkles
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
  usageCount?: number;
  lastUsedAt?: string;
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

// Separate FaqForm component to prevent re-creation on parent re-renders
interface FaqFormComponentProps {
  formData: FaqFormData;
  setFormData: React.Dispatch<React.SetStateAction<FaqFormData>>;
  editingFaq: Faq | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function FaqFormComponent({ formData, setFormData, editingFaq, onSubmit, onCancel, isSubmitting }: FaqFormComponentProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Select value={formData.category} onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}>
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
          onChange={(e) => setFormData(prev => ({ ...prev, question: e.target.value }))}
          placeholder="What are your opening hours?"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="answer">Answer</Label>
        <Textarea
          id="answer"
          value={formData.answer}
          onChange={(e) => setFormData(prev => ({ ...prev, answer: e.target.value }))}
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
          onChange={(e) => setFormData(prev => ({ ...prev, keywords: e.target.value }))}
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
            onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value, 10) || 0 }))}
            min={0}
            max={100}
          />
        </div>
        <div className="flex items-center justify-between pt-6">
          <Label htmlFor="isActive">Active</Label>
          <Switch
            id="isActive"
            checked={formData.isActive}
            onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isActive: checked }))}
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : editingFaq ? "Save Changes" : "Create FAQ"}
        </Button>
      </DialogFooter>
    </form>
  );
}

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
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [generatedFaqs, setGeneratedFaqs] = useState<Faq[]>([]);
  const [selectedGenerated, setSelectedGenerated] = useState<Set<number>>(new Set());

  // TTS Preview function using Web Speech API
  const previewFaqAnswer = (faq: Faq) => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (previewingId === faq.id) {
        setPreviewingId(null);
        return;
      }
    }

    let cleanedAnswer = faq.answer.trim();
    cleanedAnswer = cleanedAnswer.replace(/https?:\/\/[^\s]+/g, 'our website');
    cleanedAnswer = cleanedAnswer.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'email us');
    cleanedAnswer = cleanedAnswer.replace(/[•\-*]\s*/g, '. ');
    if (!cleanedAnswer.match(/[.!?]$/)) cleanedAnswer += '.';

    const utterance = new SpeechSynthesisUtterance(cleanedAnswer);
    utterance.rate = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang.startsWith('en-AU')) || voices.find(v => v.lang.startsWith('en'));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => setPreviewingId(faq.id);
    utterance.onend = () => setPreviewingId(null);
    utterance.onerror = () => {
      setPreviewingId(null);
      toast({ title: "Preview failed", description: "Unable to play TTS preview.", variant: "destructive" });
    };

    window.speechSynthesis.speak(utterance);
  };

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

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/faqs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate FAQs");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedFaqs(data.faqs);
      setSelectedGenerated(new Set(data.faqs.map((_: any, i: number) => i)));
      setIsGenerateOpen(true);
      toast({ title: "FAQs generated", description: `Generated ${data.count} FAQ suggestions.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveGeneratedFaqs = useMutation({
    mutationFn: async (faqsToSave: any[]) => {
      const results = [];
      for (const faq of faqsToSave) {
        const res = await fetch("/api/faqs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(faq),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(`Failed to save FAQ "${faq.question}": ${errorData.error || res.statusText}`);
        }

        results.push(await res.json());
      }
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: [`/api/faqs`, tenantId] });
      setIsGenerateOpen(false);
      setGeneratedFaqs([]);
      setSelectedGenerated(new Set());
      toast({
        title: "✅ FAQs saved successfully!",
        description: `Successfully saved ${results.length} FAQ${results.length !== 1 ? 's' : ''}.`
      });
    },
    onError: (err: Error) => {
      toast({
        title: "❌ Failed to save FAQs",
        description: err.message,
        variant: "destructive"
      });
    },
  });

  const handleSaveGenerated = () => {
    const faqsToSave = generatedFaqs.filter((_, i) => selectedGenerated.has(i));
    if (faqsToSave.length === 0) {
      toast({ title: "No FAQs selected", variant: "destructive" });
      return;
    }
    saveGeneratedFaqs.mutate(faqsToSave);
  };

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

  const handleCancel = () => {
    setIsCreateOpen(false);
    setEditingFaq(null);
    setFormData(defaultFormData);
  };

  const filteredFaqs = faqs?.filter(faq => {
    const matchesSearch = searchTerm === "" ||
      faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || faq.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !tenantId}>
              <Sparkles className="h-4 w-4 mr-2" />
              {generateMutation.isPending ? "Generating..." : "Generate with AI"}
            </Button>
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
                <FaqFormComponent
                  formData={formData}
                  setFormData={setFormData}
                  editingFaq={null}
                  onSubmit={handleSubmit}
                  onCancel={handleCancel}
                  isSubmitting={createMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
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
                      <Button variant="ghost" size="sm" onClick={() => previewFaqAnswer(faq)} title="Preview TTS" className={previewingId === faq.id ? "text-primary" : ""}>
                        <Volume2 className={`h-4 w-4 ${previewingId === faq.id ? "animate-pulse" : ""}`} />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(faq)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
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
                  {(faq.usageCount !== undefined && faq.usageCount > 0) || faq.lastUsedAt ? (
                    <div className="mt-3 pt-3 border-t flex items-center gap-3 text-xs text-muted-foreground">
                      {faq.usageCount !== undefined && faq.usageCount > 0 && (
                        <div className="flex items-center gap-1">
                          <BarChart3 className="h-3 w-3" />
                          <span>Used {faq.usageCount} time{faq.usageCount !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      {faq.lastUsedAt && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>Last used {new Date(faq.lastUsedAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Edit Dialog - Outside map loop */}
      <Dialog open={editingFaq !== null} onOpenChange={(open) => !open && setEditingFaq(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit FAQ</DialogTitle>
            <DialogDescription>
              Update this FAQ entry
            </DialogDescription>
          </DialogHeader>
          <FaqFormComponent
            formData={formData}
            setFormData={setFormData}
            editingFaq={editingFaq}
            onSubmit={handleSubmit}
            onCancel={() => setEditingFaq(null)}
            isSubmitting={updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* AI Generate Dialog */}
      <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review AI-Generated FAQs</DialogTitle>
            <DialogDescription>
              Select which FAQs to add to your knowledge base
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {generatedFaqs.map((faq, index) => (
              <Card key={index} className="relative">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`gen-${index}`}
                      checked={selectedGenerated.has(index)}
                      onCheckedChange={(checked) => {
                        setSelectedGenerated(prev => {
                          const newSet = new Set(prev);
                          if (checked) {
                            newSet.add(index);
                          } else {
                            newSet.delete(index);
                          }
                          return newSet;
                        });
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">
                          <Tag className="h-3 w-3 mr-1" />
                          {categories.find(c => c.value === faq.category)?.label || faq.category}
                        </Badge>
                        {faq.priority > 0 && (
                          <Badge variant="outline" className="text-xs">Priority: {faq.priority}</Badge>
                        )}
                      </div>
                      <CardTitle className="text-base">{faq.question}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{faq.answer}</p>
                  {faq.keywords && faq.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {faq.keywords.map((kw, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGenerated} disabled={saveGeneratedFaqs.isPending || selectedGenerated.size === 0}>
              {saveGeneratedFaqs.isPending ? "Saving..." : `Save ${selectedGenerated.size} FAQ${selectedGenerated.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
