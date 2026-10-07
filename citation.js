const copyButton=document.getElementById('copy-citation');
const citationCode=document.getElementById('citation-code');
const copyLabel=document.getElementById('copy-citation-label');
const copyStatus=document.getElementById('citation-status');
let copyReset;

copyButton.addEventListener('click',async()=>{
 clearTimeout(copyReset);
 try{
  await navigator.clipboard.writeText(citationCode.textContent.trim()+'\n');
  copyLabel.textContent='Copied';
  copyStatus.textContent='BibTeX copied.';
 }catch{
  const selection=window.getSelection();
  const range=document.createRange();
  range.selectNodeContents(citationCode);
  selection.removeAllRanges();selection.addRange(range);
  copyStatus.textContent='Press Ctrl+C (or ⌘C) to copy the selected citation.';
 }
 copyReset=setTimeout(()=>{copyLabel.textContent='Copy';copyStatus.textContent=''},2500);
});
