# Build What Absence Costs: pdflatex, bibtex, pdflatex twice.
# `make anon` builds the copy for double-anonymized review, with no author line.
NAME := what-absence-costs

all: $(NAME).pdf

$(NAME).pdf: $(NAME).tex sections/*.tex refs.bib
	pdflatex -interaction=nonstopmode -halt-on-error $(NAME)
	bibtex $(NAME)
	pdflatex -interaction=nonstopmode -halt-on-error $(NAME)
	pdflatex -interaction=nonstopmode -halt-on-error $(NAME)

anon: $(NAME).tex sections/*.tex refs.bib
	pdflatex -interaction=nonstopmode -halt-on-error -jobname=$(NAME)-anon '\def\anon{}\input{$(NAME)}'
	bibtex $(NAME)-anon
	pdflatex -interaction=nonstopmode -halt-on-error -jobname=$(NAME)-anon '\def\anon{}\input{$(NAME)}'
	pdflatex -interaction=nonstopmode -halt-on-error -jobname=$(NAME)-anon '\def\anon{}\input{$(NAME)}'

clean:
	rm -f *.aux *.bbl *.blg *.log *.out *.toc

.PHONY: all anon clean
