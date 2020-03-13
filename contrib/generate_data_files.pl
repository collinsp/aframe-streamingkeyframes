#!/usr/bin/perl

# simple perl script to extract frame data from the FrameFile.txt file into separate data files that can be steamed to the browser

use strict;
use FindBin qw($Bin);
chdir "$Bin/../" or die "could not chdir $Bin/../";

if (-d "data") {
  my @files = glob("data/*"); 
  unlink @files;
}
else {
  mkdir "data" or die "could not mkdir data";
}
open my $fh, "< $Bin/FrameFile.txt" or die;

my $line = <$fh>;
chomp $line;
die "expected line: Frame Data File\n" if $line ne 'Frame Data File';

my $line = <$fh>;
chomp $line;
die "expected > 0 - got: $line" unless $line > 0;

my $lastFrameNum = 0;
my $lastTotalParticles=0;
my $outfh;
my $foundParticlesInFrame=0;

while (<$fh>) {
  my $line = $_;
  chomp $line;

  if ($line =~ /^(\d+)$/) {

    die "in frame $lastFrameNum, found $foundParticlesInFrame particles, should have been $lastTotalParticles\n" if $foundParticlesInFrame != $lastTotalParticles;

    my $frameNum = $1;
    die "expected frame num: ".($lastFrameNum + 1)." but got frameNum: $frameNum" unless (($lastFrameNum + 1) == $frameNum);
    my $totalParticles = <$fh>;
    chomp $totalParticles;
    die "expected totalParticles > 0" unless $totalParticles > 0;
    $lastTotalParticles = $totalParticles;
    $lastFrameNum = $frameNum;

    close $outfh if $outfh;
    open $outfh, "> data/$frameNum.txt" or die "could not write data/$frameNum.txt"; 
    print $outfh "$frameNum\n$totalParticles";
    $foundParticlesInFrame=0;
  }

  elsif ($line) {
    $foundParticlesInFrame++;
    print $outfh "\n".$line;
  }
}

