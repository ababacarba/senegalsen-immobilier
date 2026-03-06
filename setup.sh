#!/bin/bash
# SeneGalsen — Script de déploiement GitHub + Vercel
# Usage: bash setup.sh TON_USERNAME_GITHUB

USERNAME=$1

if [ -z "$USERNAME" ]; then
  echo "❌ Usage: bash setup.sh TON_USERNAME_GITHUB"
  exit 1
fi

echo "🚀 Initialisation du repo Git..."
git init
git checkout -b main

echo "📦 Ajout des fichiers..."
git add .
git status

echo "💾 Premier commit..."
git commit -m "feat: SeneGalsen Immobilier v4 🏠"

echo "🔗 Connexion au repo GitHub..."
git remote add origin https://github.com/$USERNAME/senegalsen-immobilier.git

echo "⬆️  Push vers GitHub (branche main)..."
git push -u origin main

echo ""
echo "✅ Terminé ! Maintenant va sur :"
echo "👉 https://vercel.com/new"
echo "   → Import Git Repository"
echo "   → Sélectionne : senegalsen-immobilier"
echo "   → Framework Preset : Vite"
echo "   → Clique Deploy !"
