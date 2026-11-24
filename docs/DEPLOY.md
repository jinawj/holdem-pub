# GitHub Pages 배포 가이드

결과: `https://(내아이디).github.io/holdem-pub/` 링크로 누구나 접속.
기록은 각자 브라우저에 저장. 이후에는 `git push`만 하면 자동 업데이트.

이미 준비된 것: `.gitignore`, `.github/workflows/deploy.yml` (push하면 테스트 → 빌드 → 배포 자동)

---

## 1단계. git 설치 (한 번만)
PowerShell에서:
```powershell
winget install --id Git.Git -e
```
설치 후 **PowerShell 창을 닫았다가 다시 열고** 확인:
```powershell
git --version
```

## 2단계. 내 이름·이메일 등록 (한 번만)
커밋에 기록될 이름입니다. 이메일은 GitHub 가입 이메일과 같게.
```powershell
git config --global user.name "내이름"
```
```powershell
git config --global user.email "내이메일@example.com"
```

## 3단계. GitHub 가입 + 저장소 만들기
1. https://github.com 가입
2. 오른쪽 위 **+ → New repository**
3. Repository name: `holdem-pub`
4. **Public** 선택 (무료 GitHub Pages는 공개 저장소 필요)
5. README·.gitignore 추가 옵션은 **체크하지 않음** (빈 저장소로)
6. **Create repository**

## 4단계. 첫 업로드
프로젝트 폴더에서 PowerShell을 열고 한 줄씩 실행 (`내아이디`를 바꿔서):
```powershell
git init -b main
```
```powershell
git add .
```
```powershell
git commit -m "홀덤펍 토너먼트 첫 버전"
```
```powershell
git remote add origin https://github.com/내아이디/holdem-pub.git
```
```powershell
git push -u origin main
```
처음 push할 때 브라우저 로그인 창이 뜨면 GitHub로 로그인 → 허용.

## 5단계. GitHub Pages 켜기
1. GitHub 저장소 페이지 → **Settings → Pages**
2. **Source**를 **GitHub Actions** 로 선택
3. 저장소 **Actions** 탭에서 "Deploy to GitHub Pages"가 초록 체크가 될 때까지 대기 (2~3분)
   - 처음 push가 Pages 켜기 전이었다면 Actions 탭 → 해당 작업 → **Re-run all jobs**
4. 링크: `https://내아이디.github.io/holdem-pub/`

## 6단계. 확인
- PC·폰에서 링크 열기 → 토너먼트 시작 → 새로고침 → "이어하기"가 뜨면 저장 정상
- 아이폰: 사파리 → 공유 → **홈 화면에 추가** (앱처럼 전체 화면, 저장 데이터가 덜 지워짐)

## 이후 업데이트할 때
Claude에게 수정을 요청한 뒤:
```powershell
git add .
```
```powershell
git commit -m "수정 내용 한 줄"
```
```powershell
git push
```
몇 분 뒤 같은 링크에 자동 반영. (테스트가 실패하면 배포되지 않고 Actions 탭에 빨간 X)

## 문제가 생기면
- `git`을 못 찾음 → PowerShell 다시 열기
- push 때 권한 오류 → 저장소 주소의 아이디가 맞는지, 로그인한 계정이 저장소 주인인지 확인
- 링크가 404 → 5단계 Source가 GitHub Actions인지, Actions가 초록 체크인지 확인
- 사용자에게 안내: 브라우저 데이터를 지우면 기록이 사라지므로 메뉴의 **파일 내보내기**로 백업
